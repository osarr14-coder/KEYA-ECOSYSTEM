import type {
  BackofficeUserDetail, BackofficeUserSummary, LoginResult, Me,
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
  /**
   * Ticket 021 — optionnel, absent par défaut (`() => null`) : jusqu'au
   * ticket 020, cette app n'avait aucune session propre au-delà de la
   * connexion elle-même (`getMe` recevait le token en argument explicite,
   * jamais `localStorage`). Depuis que `admin_keyimmo` peut se rediriger
   * vers apps/web elle-même (back-office, `redirectTarget.ts`), `main.tsx`
   * fournit désormais ce lecteur pour les appels authentifiés du
   * back-office (`searchUsers`/`getUserDetail`/`deactivateUser`) — même
   * mécanisme que `apps/{home,build,control-pwa}`.
   */
  getAccessToken?: () => string | null;
}

interface RequestOptions {
  method?: string;
  json?: unknown;
}

function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Client HTTP minimal. `login`/`getMe` restent tels quels depuis le ticket
 * 020 (signatures inchangées, `getMe` accepte toujours un token explicite en
 * argument — utilisé par le formulaire de connexion, AVANT toute écriture en
 * `localStorage`). Les méthodes back-office (ticket 021) passent par
 * `request`, qui lit `getAccessToken()` — le token déjà persisté par
 * `receiveIncomingSession`/le mécanisme manuel.
 */
export function createApiClient({ baseUrl, getAccessToken = () => null }: ApiClientConfig) {
  async function request<T>(path: string, options: RequestOptions = {}, tokenOverride?: string): Promise<T> {
    const token = tokenOverride ?? getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }

    const response = await fetch(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers, body });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de la requête ${path} (${response.status})`);
    }
    return (await response.json()) as T;
  }

  /**
   * `POST /api/auth/login/` (`TokenObtainPairView`, simplejwt — ticket 001).
   * Vérifié empiriquement (ticket 020) : identifiants invalides, compte
   * désactivé (`is_active=False`, ticket 011) et email inexistant renvoient
   * TOUS le même 401 générique (« No active account found with the given
   * credentials ») — comportement standard de simplejwt, volontairement non
   * distinctif (évite l'énumération de comptes). Aucun message différencié
   * n'existe côté backend à distinguer ici. Jamais de token à envoyer ici
   * (endpoint public) — appel direct, pas via `request`.
   */
  async function login(email: string, password: string): Promise<LoginResult> {
    const response = await fetch(`${baseUrl}/api/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de connexion (${response.status})`);
    }
    return (await response.json()) as LoginResult;
  }

  return {
    login,
    /** Sans argument, lit `getAccessToken()` (session déjà persistée —
     * ticket 021). Avec un token explicite, l'utilise à la place (ticket
     * 020 : le formulaire de connexion appelle `getMe(access)` avec le
     * token qui VIENT d'être obtenu par `login`, avant toute écriture en
     * `localStorage`). */
    getMe: (accessToken?: string) => request<Me>('/api/me/', {}, accessToken),

    /**
     * `GET /api/backoffice/users/?q=...` (ticket 011, réservé à
     * `admin_keyimmo`). `q` vide ou absent renvoie une liste vide côté
     * backend (jamais un dump complet) — comportement du serveur, pas
     * recalculé ici.
     */
    searchUsers: (query: string) =>
      request<BackofficeUserSummary[]>(`/api/backoffice/users/${toQueryString({ q: query })}`),

    /** `GET /api/backoffice/users/{id}/` (ticket 011) — organisation(s)/
     * rôle(s) de l'utilisateur ciblé, strictement lecture seule. */
    getUserDetail: (userId: string) => request<BackofficeUserDetail>(`/api/backoffice/users/${userId}/`),

    /** `POST /api/backoffice/users/{id}/deactivate/` (ticket 011) — pose
     * `is_active=False`, aucune autre donnée touchée. Action réellement
     * destructive pour l'accès : l'UI (ticket 021) exige une confirmation
     * explicite AVANT cet appel, jamais déclenché par un simple clic. */
    deactivateUser: (userId: string) =>
      request<BackofficeUserSummary>(`/api/backoffice/users/${userId}/deactivate/`, { method: 'POST' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
