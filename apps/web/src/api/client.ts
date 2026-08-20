import type {
  BackofficeUserDetail, BackofficeUserSummary, CurrentPricingRates, Devis,
  DevisAjustement, DevisAjustementCreateResult, LoginResult, LotSearchResult,
  Me, OrganizationSearchResult, PricingCanal, PricingConfig,
} from './types';

export class ApiError extends Error {
  status: number;

  /**
   * Ticket 027 — corps `{detail: "..."}` d'une réponse 409 (`LotAlreadyLockedError`/
   * `NoPricingConfigError`/`DevisNotLockedError`/`MarginExceededError`, voir
   * `apps/procurement/views.py`) : le message métier exact vient du backend,
   * jamais reconstruit ici. `undefined` si le corps n'est pas du JSON exploitable
   * ou n'a pas de champ `detail` (ex. erreurs 400 de validation DRF, forme
   * différente) — les appelants existants (back-office, ticket 021) n'en avaient
   * jamais besoin, ce champ reste optionnel pour ne rien changer à leur usage.
   */
  detail?: string;

  /**
   * Ticket F-028 — corps BRUT de la réponse d'erreur, quelle que soit sa
   * forme (`{detail: "..."}` OU le format de validation DRF par défaut,
   * `{champ: ["message", ...]}`, ex. `PricingConfigCreateView`, qui ne
   * renvoie JAMAIS `detail`). `detail` reste le raccourci pour le cas
   * `{detail}` déjà géré partout ailleurs ; `body` permet à un appelant
   * (voir `PricingView.tsx`) de lire un format différent sans que ce
   * client générique ait à connaître chaque forme d'erreur possible.
   */
  body?: unknown;

  constructor(status: number, message: string, detail?: string, body?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.body = body;
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
      // Ticket 027 : lit le corps d'erreur pour en extraire `detail` (409
      // métier, voir `ApiError.detail`) — `.catch(() => undefined)` couvre
      // le cas d'un corps vide/non-JSON (ex. 401/500 sans corps structuré),
      // jamais une exception qui masquerait l'erreur HTTP d'origine. Ticket
      // F-028 : le corps BRUT est conservé tel quel (`ApiError.body`) pour
      // les appelants dont les erreurs n'ont pas la forme `{detail}`.
      const errorBody = (await response.json().catch(() => undefined)) as { detail?: string } | undefined;
      throw new ApiError(response.status, `Échec de la requête ${path} (${response.status})`, errorBody?.detail, errorBody);
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

    /**
     * `GET /api/procurement/admin/lots/{lot_id}/devis/?organization_id=...`
     * (ticket 022) — `organizationId` est celle du LOT, jamais celle du
     * candidat (voir `apps.procurement.services.list_devis_for_lot_as_admin`).
     * Seul endpoint de ce module qui expose des montants.
     */
    listDevisForLot: (lotId: string, organizationId: string) =>
      request<Devis[]>(`/api/procurement/admin/lots/${lotId}/devis/${toQueryString({ organization_id: organizationId })}`),

    /**
     * `POST /api/procurement/devis/` (ticket 022, `marge_estimee` retiré du
     * payload d'entrée au ticket 026 — dérivée backend depuis
     * `PricingConfig`, jamais envoyée ici). 409 si le lot est déjà
     * verrouillé (`LotAlreadyLockedError`) ou si aucun `PricingConfig`
     * actif n'existe pour le pays du lot (`NoPricingConfigError`) — les
     * deux portent un `detail` exploitable via `ApiError.detail`.
     */
    createDevis: (payload: { organization: string; lot: string; candidate_organization: string; amount: string }) =>
      request<Devis>('/api/procurement/devis/', { method: 'POST', json: payload }),

    /**
     * `POST /api/procurement/devis/{id}/lock/` (ticket 022) — verrouille LE
     * devis retenu pour son lot. `organization` est celle du lot. 409 si un
     * devis est déjà verrouillé pour ce lot.
     */
    lockDevis: (devisId: string, organization: string) =>
      request<Devis>(`/api/procurement/devis/${devisId}/lock/`, { method: 'POST', json: { organization } }),

    /**
     * `GET /api/procurement/devis/{id}/ajustements/?organization_id=...`
     * (ticket 023) — historique complet, jamais de `marge_resultante` par
     * ligne (uniquement présente sur la réponse `POST`, voir
     * `createAjustement` ci-dessous).
     */
    listAjustements: (devisId: string, organizationId: string) =>
      request<DevisAjustement[]>(`/api/procurement/devis/${devisId}/ajustements/${toQueryString({ organization_id: organizationId })}`),

    /**
     * `POST /api/procurement/devis/{id}/ajustements/` (ticket 023) — `ecart`
     * est SIGNÉ (positif = défavorable, négatif = favorable). 409 si le
     * devis n'est pas verrouillé (`DevisNotLockedError`) ou si l'écart
     * dépasse la marge disponible courante (`MarginExceededError`) — les
     * deux portent un `detail` exploitable via `ApiError.detail`.
     */
    createAjustement: (devisId: string, payload: { organization: string; ecart: string }) =>
      request<DevisAjustementCreateResult>(`/api/procurement/devis/${devisId}/ajustements/`, { method: 'POST', json: payload }),

    /**
     * `GET /api/procurement/admin/lots/?q=...` (ticket B-028) — recherche de
     * lot par nom, toutes organisations confondues (y compris celles dont
     * l'admin n'est membre d'AUCUNE, voir `apps.procurement.services.
     * search_lots_as_admin`). `q` vide renvoie une liste vide côté backend
     * (jamais un dump complet, même discipline que `searchUsers`). Les lots
     * DÉJÀ verrouillés sont exclus par le backend lui-même (décision D) —
     * jamais un filtre reconstruit ici.
     */
    searchLots: (query: string) =>
      request<LotSearchResult[]>(`/api/procurement/admin/lots/${toQueryString({ q: query })}`),

    /**
     * `GET /api/procurement/admin/organizations/?q=...` (ticket B-028) —
     * recherche d'organisation par nom, pour résoudre `candidate_organization`
     * avant `POST /api/procurement/devis/`. `q` vide renvoie une liste vide.
     */
    searchOrganizations: (query: string) =>
      request<OrganizationSearchResult[]>(`/api/procurement/admin/organizations/${toQueryString({ q: query })}`),

    /**
     * `GET /api/pricing/configs/current/?country_pack_id=...` (ticket
     * 025-backend) — taux ACTUEL des deux canaux (dernier `PricingConfig`
     * créé par canal), `null` par canal si aucun n'existe encore.
     */
    getCurrentPricingRates: (countryPackId: string) =>
      request<CurrentPricingRates>(`/api/pricing/configs/current/${toQueryString({ country_pack_id: countryPackId })}`),

    /**
     * `GET /api/pricing/configs/history/?country_pack_id=...&canal=...`
     * (ticket 025-backend) — historique COMPLET d'un `(country_pack,
     * canal)`, du plus ancien au plus récent. `canal` est requis (pas de
     * variante « les deux canaux à la fois » côté backend pour cet
     * endpoint, contrairement à `getCurrentPricingRates`).
     */
    getPricingHistory: (countryPackId: string, canal: PricingCanal) =>
      request<PricingConfig[]>(`/api/pricing/configs/history/${toQueryString({ country_pack_id: countryPackId, canal })}`),

    /**
     * `POST /api/pricing/configs/` (ticket 025-backend) — crée un NOUVEAU
     * taux, jamais une modification (aucun endpoint `PUT`/`PATCH`/`DELETE`
     * n'existe pour cette ressource). Erreurs en 400, forme de validation
     * DRF standard (`{champ: ["message"]}`), PAS `{detail}` — voir
     * `ApiError.body`.
     */
    createPricingConfig: (payload: { country_pack: string; canal: PricingCanal; rate: string }) =>
      request<PricingConfig>('/api/pricing/configs/', { method: 'POST', json: payload }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
