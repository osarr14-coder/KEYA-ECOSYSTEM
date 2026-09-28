import type {
  CatalogLot, ClientPaymentCall, ContractVersion, EvidenceFeedItem, LotOverview, Me, MyLot, ProgramRequest, Reservation, Task,
  WorksiteMilestone,
} from './types';

export class ApiError extends Error {
  status: number;

  /**
   * Ticket F-057 — corps `{champ: ["message", ...]}` d'une réponse 400 de
   * validation DRF (ex. `description` vide, `POST /api/programs/
   * requests/`) : même principe que `ApiError.body`, apps/web, ticket
   * F-028 — ce client générique n'a pas à connaître chaque forme d'erreur
   * possible, l'appelant lit ce champ si besoin. `undefined` si le corps
   * n'est pas du JSON exploitable.
   */
  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
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

  /**
   * Ticket F-033 (vague 4) — un 401 EN COURS DE SESSION (token expiré,
   * compte désactivé mid-session, ticket 011) signifie que le jeton détenu
   * est définitivement mort : aucun retry ne peut le réparer, contrairement
   * à un 403 (session valide, permission refusée pour CETTE ressource —
   * voir `isForbiddenError`, design-system). Appelé de façon SYNCHRONE dès
   * la détection, pour CHAQUE requête, quel que soit l'appelant.
   */
  onUnauthorized?: () => void;
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

interface RequestOptions {
  method?: string;
  json?: unknown;
}

/**
 * Client HTTP minimal — chaque méthode correspond exactement à un endpoint
 * `apps/home`/`apps/tasks` côté backend, qui a déjà tout calculé (progression,
 * statut). Ce fichier ne fait AUCUN calcul, uniquement des requêtes GET et
 * un passage direct du JSON reçu — critère d'acceptation central du
 * ticket 008.
 *
 * Ticket F-057 — `RequestOptions`/corps JSON ajoutés : première écriture de
 * cette app (`createProgramRequest` ci-dessous), jusqu'ici strictement
 * lecture seule (ticket 008). Même forme que `apps/web/src/api/client.ts`
 * (ticket 022), pas un mécanisme réinventé.
 */
export function createApiClient({
  baseUrl, getAccessToken, getActiveOrganizationId, onUnauthorized,
}: ApiClientConfig) {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const organizationId = getActiveOrganizationId?.();
    if (organizationId) headers['X-Organization-Id'] = organizationId;

    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }

    const response = await fetch(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers, body });
    if (response.status === 401) {
      onUnauthorized?.();
    }
    if (!response.ok) {
      const errorBody = await response.json().catch(() => undefined);
      throw new ApiError(response.status, `Échec de la requête ${path} (${response.status})`, errorBody);
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
      // Ticket F-071 — boîte TRANSVERSE (backend B-056) : les tâches du
      // circuit de vente vivent dans l'organisation du lot, jamais dans
      // celle du client ; mêmes filtres que `/api/me/tasks/`.
      return request<Task[]>(`/api/me/tasks/inbox/${query ? `?${query}` : ''}`);
    },
    // Ticket F-057 — demande de programme sur mesure (rôle sponsor).
    getMyProgramRequests: () => request<ProgramRequest[]>('/api/programs/requests/mine/'),
    createProgramRequest: (description: string) => (
      request<ProgramRequest>('/api/programs/requests/', { method: 'POST', json: { description } })
    ),
    /**
     * `POST /api/tasks/{id}/complete/` (ticket 006/F-062) — marque une
     * tâche traitée, jamais son sujet (`apps.tasks.services.
     * complete_task` ne touche que la `Task` elle-même).
     */
    completeTask: (taskId: string, organizationId?: string) => (
      organizationId
        ? request<Task>(
          `/api/me/tasks/${taskId}/inbox-complete/?${new URLSearchParams({ organization_id: organizationId })}`,
          { method: 'POST' },
        )
        : request<Task>(`/api/tasks/${taskId}/complete/`, { method: 'POST' })
    ),
    // Ticket F-066 — catalogue et réservations (backend B-048).
    getCatalogLots: () => request<CatalogLot[]>('/api/catalog/lots/'),
    getMyReservations: () => request<Reservation[]>('/api/me/reservations/'),
    requestReservation: (lotId: string, organizationId: string) => (
      request<Reservation>('/api/reservations/', { method: 'POST', json: { lot: lotId, organization: organizationId } })
    ),
    cancelMyReservation: (reservationId: string) => (
      request<Reservation>(`/api/me/reservations/${reservationId}/cancel/`, { method: 'POST' })
    ),
    // Ticket F-066 (partie 2) — contrat fictif (backend B-049).
    getMyContracts: (reservationId: string) => (
      request<ContractVersion[]>(`/api/me/reservations/${reservationId}/contracts/`)
    ),
    signContract: (contractId: string) => (
      request<ContractVersion>(`/api/me/contracts/${contractId}/sign/`, { method: 'POST' })
    ),
    /** PO-2026-09-28-04 — suivi du chantier du bien du client. */
    getMyWorksite: (reservationId: string) => (
      request<WorksiteMilestone[]>(`/api/me/reservations/${reservationId}/worksite/`)
    ),
    // Ticket F-068 — appels de fonds du client (backend B-050/B-051).
    getMyPaymentCalls: (reservationId: string) => (
      request<ClientPaymentCall[]>(`/api/me/reservations/${reservationId}/payment-calls/`)
    ),
    /** Ticket F-071 — « J'ai effectué le virement » (backend B-056) : une
     * déclaration, confirmée ensuite par Finance. */
    declarePayment: (paymentCallId: string, payload: { client_reference: string; paid_on: string }) => (
      request<unknown>(`/api/me/payment-calls/${paymentCallId}/notices/`, { method: 'POST', json: payload })
    ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
