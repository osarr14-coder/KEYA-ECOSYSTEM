import type { EvidenceFeedItem, LotOverview, MyLot, Task } from './types';

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
}

/**
 * Client HTTP minimal — chaque méthode correspond exactement à un endpoint
 * `apps/home`/`apps/tasks` côté backend, qui a déjà tout calculé (progression,
 * statut). Ce fichier ne fait AUCUN calcul, uniquement des requêtes GET et
 * un passage direct du JSON reçu — critère d'acceptation central du
 * ticket 008.
 */
export function createApiClient({ baseUrl, getAccessToken }: ApiClientConfig) {
  async function request<T>(path: string): Promise<T> {
    const token = getAccessToken();
    const response = await fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de la requête ${path} (${response.status})`);
    }
    return (await response.json()) as T;
  }

  return {
    getMyLots: () => request<MyLot[]>('/api/me/lots/'),
    getLotOverview: (lotId: string) => request<LotOverview>(`/api/me/lots/${lotId}/overview/`),
    getLotEvidenceFeed: (lotId: string) => request<EvidenceFeedItem[]>(`/api/me/lots/${lotId}/evidence/`),
    getMyTasks: () => request<Task[]>('/api/me/tasks/'),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
