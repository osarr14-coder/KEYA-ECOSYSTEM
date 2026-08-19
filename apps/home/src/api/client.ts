import type { EvidenceFeedItem, LotOverview, Me, MyLot, Task } from './types';

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
   * encore résolue (avant le premier `getMe()`) — le backend retombe alors
   * sur la membership la plus ancienne, son propre comportement par
   * défaut, jamais recalculé ici. */
  getActiveOrganizationId?: () => string | null;
}

export interface TaskFilters {
  type?: string;
  status?: string;
  program?: string;
  /** `'priority'` — voir `apps/tasks/views.py::MyTasksView`, ajouté pour ce
   * ticket : tri haute priorité d'abord, puis échéance la plus proche.
   * Aucun autre tri n'est calculé ici, seul le paramètre est transmis tel
   * quel — le tri lui-même reste entièrement côté backend. */
  ordering?: string;
}

/**
 * Client HTTP minimal — chaque méthode correspond exactement à un endpoint
 * `apps/home`/`apps/tasks` côté backend, qui a déjà tout calculé (progression,
 * statut). Ce fichier ne fait AUCUN calcul, uniquement des requêtes GET et
 * un passage direct du JSON reçu — critère d'acceptation central du
 * ticket 008.
 */
export function createApiClient({ baseUrl, getAccessToken, getActiveOrganizationId }: ApiClientConfig) {
  async function request<T>(path: string): Promise<T> {
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const organizationId = getActiveOrganizationId?.();
    if (organizationId) headers['X-Organization-Id'] = organizationId;

    const response = await fetch(`${baseUrl}${path}`, { headers });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de la requête ${path} (${response.status})`);
    }
    return (await response.json()) as T;
  }

  return {
    getMe: () => request<Me>('/api/me/'),
    getMyLots: () => request<MyLot[]>('/api/me/lots/'),
    getLotOverview: (lotId: string) => request<LotOverview>(`/api/me/lots/${lotId}/overview/`),
    getLotEvidenceFeed: (lotId: string) => request<EvidenceFeedItem[]>(`/api/me/lots/${lotId}/evidence/`),
    getMyTasks: (filters: TaskFilters = {}) => {
      const params = new URLSearchParams();
      if (filters.type) params.set('type', filters.type);
      if (filters.status) params.set('status', filters.status);
      if (filters.program) params.set('program', filters.program);
      if (filters.ordering) params.set('ordering', filters.ordering);
      const query = params.toString();
      return request<Task[]>(`/api/me/tasks/${query ? `?${query}` : ''}`);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
