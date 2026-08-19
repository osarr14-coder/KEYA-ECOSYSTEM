import type {
  AllLotsQuery,
  ExceptionsPayload,
  LotRow,
  Me,
  PaginatedResponse,
} from './types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken: () => string | null;
  /** Ticket 019 — organisation active choisie via l'App Switcher (`GET
   * /me`, `apps.core.middleware.OrganizationScopeMiddleware`, ticket 001) :
   * transmise sur CHAQUE requête dès qu'elle est connue. `null` = pas
   * encore résolue — le backend retombe alors sur la membership la plus
   * ancienne, son propre comportement par défaut, jamais recalculé ici. */
  getActiveOrganizationId?: () => string | null;
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  formData?: FormData;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Client HTTP minimal — chaque méthode correspond à un endpoint qui a déjà
 * tout calculé côté backend (exceptions, progression, tri/filtre/pagination
 * de « Tous les lots »). Ce fichier ne fait AUCUN calcul, uniquement des
 * requêtes et un passage direct du JSON reçu.
 */
export function createApiClient({ baseUrl, getAccessToken, getActiveOrganizationId }: ApiClientConfig) {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const organizationId = getActiveOrganizationId?.();
    if (organizationId) headers['X-Organization-Id'] = organizationId;

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }

    const response = await fetch(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers, body });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de la requête ${path} (${response.status})`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    getMe: () => request<Me>('/api/me/'),
    getExceptions: () => request<ExceptionsPayload>('/api/build/exceptions/'),
    getAllLots: (query: AllLotsQuery = {}) =>
      request<PaginatedResponse<LotRow>>(`/api/build/lots/${toQueryString(query as Record<string, string | number | undefined>)}`),

    /** Point d'ancrage minimal PRO (ticket 009) — voir Lot.assigned_organization. */
    assignLotOrganization: (lotId: string, organizationId: string) =>
      request(`/api/lots/${lotId}/assign_organization/`, {
        method: 'POST', json: { organization_id: organizationId },
      }),

    /** Action réelle sur une réserve ouverte — ne modifie JAMAIS le statut
     * de la réserve directement (voir apps/inspections/services.py,
     * ticket 005) : crée un nouvel événement `correction_proposee`. */
    createReserveCorrection: (reserveId: string, evidenceId: string) =>
      request('/api/reserve-corrections/', {
        method: 'POST', json: { reserve: reserveId, evidence: evidenceId },
      }),

    /** Action réelle sur « documents manquants » : upload d'un Document
     * (endpoint existant, multipart) PUIS création de l'Evidence qui le
     * rattache à la déclaration de travaux — deux endpoints réels
     * enchaînés, aucun nouveau endpoint créé pour ce ticket. */
    addEvidenceDocument: async (params: {
      workDeclarationId: string; file: File; category: string; source: string;
    }) => {
      const formData = new FormData();
      formData.append('file', params.file);
      formData.append('category', params.category);
      formData.append('source', params.source);
      const document = await request<{ id: string }>('/api/documents/', { method: 'POST', formData });
      return request('/api/evidences/', {
        method: 'POST',
        json: { work_declaration: params.workDeclarationId, documents: [document.id] },
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
