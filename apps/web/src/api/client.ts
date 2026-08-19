import type { LoginResult, Me } from './types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiClientConfig {
  baseUrl: string;
}

/**
 * Client HTTP minimal, volontairement SANS `getAccessToken` (contrairement
 * à `apps/home`/`apps/build`) : cette app n'a pas de session propre au-delà
 * de la connexion elle-même — `getMe` reçoit le token qui vient tout juste
 * d'être obtenu par `login`, en argument explicite, jamais lu depuis
 * `localStorage` (ticket 020).
 */
export function createApiClient({ baseUrl }: ApiClientConfig) {
  /**
   * `POST /api/auth/login/` (`TokenObtainPairView`, simplejwt — ticket 001).
   * Vérifié empiriquement (ticket 020) : identifiants invalides, compte
   * désactivé (`is_active=False`, ticket 011) et email inexistant renvoient
   * TOUS le même 401 générique (« No active account found with the given
   * credentials ») — comportement standard de simplejwt, volontairement non
   * distinctif (évite l'énumération de comptes). Aucun message différencié
   * n'existe côté backend à distinguer ici.
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

  /** `GET /api/me/` avec le token OBTENU À L'INSTANT par `login` — jamais
   * `localStorage`, cette app n'y écrit qu'une fois la cible de redirection
   * déterminée (voir `App.tsx`). */
  async function getMe(accessToken: string): Promise<Me> {
    const response = await fetch(`${baseUrl}/api/me/`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de récupération du profil (${response.status})`);
    }
    return (await response.json()) as Me;
  }

  return { login, getMe };
}

export type ApiClient = ReturnType<typeof createApiClient>;
