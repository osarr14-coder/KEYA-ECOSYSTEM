import type {
  BackofficeUserDetail, BackofficeUserSummary, CountryPackSummary,
  CurrentPricingRates, Devis, DevisAjustement, DevisAjustementCreateResult,
  LegalPaymentTierStepInput, LegalPaymentTierTemplate, LoginResult, LotLedger,
  LotSearchResult, Me, OrganizationSearchResult, PricingCanal, PricingConfig,
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

  /**
   * Ticket F-033 (vague 4) — un 401 EN COURS DE SESSION (token expiré,
   * compte désactivé mid-session — ticket 011 : un jeton déjà émis est
   * revérifié à CHAQUE requête, jamais seulement à l'émission) signifie que
   * le jeton détenu est définitivement mort : aucun retry ne peut jamais le
   * réparer, contrairement à un 403 (session valide, permission refusée
   * pour CETTE ressource — voir `isForbiddenError`, design-system).
   * Appelé de façon SYNCHRONE dès la détection, jamais seulement quand
   * l'appelant choisit de traiter l'erreur — un 401 n'a AUCUN chemin de
   * récupération manuel valable, contrairement à un 403. Jamais déclenché
   * par `login()` ci-dessous (identifiants invalides ≠ session morte,
   * déjà traité distinctement par le formulaire de connexion, ticket 020).
   */
  onUnauthorized?: () => void;
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
export function createApiClient({ baseUrl, getAccessToken = () => null, onUnauthorized }: ApiClientConfig) {
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
    if (response.status === 401) {
      onUnauthorized?.();
    }
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
    // Ticket F-030 : bug réel trouvé en vérifiant `getActiveLegalPaymentTierTemplate`
    // en navigateur réel — DRF's `Response(None)` (ex.
    // `LegalPaymentTierTemplateActiveView`, quand aucun template n'est actif)
    // rend un corps VRAIMENT VIDE, pas le littéral JSON `null` : `response.json()`
    // lève alors une `SyntaxError` (« Unexpected end of JSON input »), jamais
    // rattrapée avant ce correctif, faisant passer une réponse 200 légitime
    // pour une erreur réseau côté `useApiResource`. Lire le corps en texte
    // d'abord permet de distinguer les deux cas sans changer le comportement
    // des appelants existants (aucun autre endpoint de ce projet ne renvoie de
    // corps 200 vide à ce jour).
    const text = await response.text();
    return (text === '' ? null : JSON.parse(text)) as T;
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

    /**
     * `POST /api/pricing/legal-payment-tier-templates/` (ticket B-027) —
     * crée un template BROUILLON avec ses paliers en une seule requête.
     * `steps` peut être envoyé dans n'importe quel ordre (le backend trie
     * lui-même par `order`). Erreurs en 400, forme de validation DRF
     * standard (`{champ: ["message"]}`) — ex. `steps` non strictement
     * croissants ou dernier palier ≠ 100 — voir `ApiError.body`.
     */
    createLegalPaymentTierTemplate: (
      payload: { country_pack: string; version: number; steps: LegalPaymentTierStepInput[] },
    ) => request<LegalPaymentTierTemplate>(
      '/api/pricing/legal-payment-tier-templates/', { method: 'POST', json: payload },
    ),

    /**
     * `POST /api/pricing/legal-payment-tier-templates/{id}/activate/`
     * (ticket B-027) — aucun corps de requête (`template_id` suffit, dans
     * l'URL). Pose `activated_by`/`activated_at` sur CE template (jamais
     * réécrits ensuite) puis bascule le pointeur d'actif de son pays —
     * l'ancien actif, s'il existe, n'est jamais modifié.
     */
    activateLegalPaymentTierTemplate: (templateId: string) =>
      request<LegalPaymentTierTemplate>(
        `/api/pricing/legal-payment-tier-templates/${templateId}/activate/`, { method: 'POST' },
      ),

    /**
     * `GET /api/pricing/legal-payment-tier-templates/active/?country_pack_id=...`
     * (ticket B-027) — le template ACTUELLEMENT actif pour ce pays (via le
     * pointeur `ActiveLegalPaymentTierTemplate`), `null` si aucun n'a
     * jamais été activé. Jamais dérivé d'un tri sur `activated_at` côté
     * frontend — ce serait faux (voir `LegalPaymentTierTemplate` dans
     * `types.ts`).
     */
    getActiveLegalPaymentTierTemplate: (countryPackId: string) =>
      request<LegalPaymentTierTemplate | null>(
        `/api/pricing/legal-payment-tier-templates/active/${toQueryString({ country_pack_id: countryPackId })}`,
      ),

    /**
     * `GET /api/pricing/legal-payment-tier-templates/history/?country_pack_id=...`
     * (ticket B-027) — TOUS les templates d'un pays (brouillons et
     * activés), triés par `version`.
     */
    getLegalPaymentTierTemplateHistory: (countryPackId: string) =>
      request<LegalPaymentTierTemplate[]>(
        `/api/pricing/legal-payment-tier-templates/history/${toQueryString({ country_pack_id: countryPackId })}`,
      ),

    /**
     * `GET /api/organizations/country-packs/` (ticket B-030) — TOUS les
     * `CountryPack` actifs, triés par `label`. Aucun paramètre `q` côté
     * backend (liste complète, pas une recherche filtrée) — contrairement
     * à `searchLots`/`searchOrganizations` (ticket B-028). Lève la
     * dépendance documentée dans `F-028-administration-tarifs.md`/
     * `F-030-paliers-legaux-paiement.md` (sélecteur de pays temporaire par
     * UUID manuel).
     */
    listCountryPacks: () => request<CountryPackSummary[]>('/api/organizations/country-packs/'),

    /**
     * `GET /api/procurement/lot-ledgers/{lot_id}/?organization_id=...`
     * (ticket B-035) — `null` si aucun grand-livre n'existe encore pour ce
     * lot (corps 200 vide, jamais une 404 — même convention que
     * `getActiveLegalPaymentTierTemplate`).
     */
    getLotLedger: (lotId: string, organizationId: string) =>
      request<LotLedger | null>(`/api/procurement/lot-ledgers/${lotId}/${toQueryString({ organization_id: organizationId })}`),

    /**
     * `GET /api/procurement/lot-ledgers/{lot_id}/margin/?organization_id=...`
     * (ticket B-035) — marge disponible COURANTE, calculée à la volée
     * côté backend (`apps.procurement.services.get_lot_ledger_margin`,
     * formule volontairement incomplète, TODO B-036 — voir
     * F-035-grand-livre-lot.md). 404 si aucun grand-livre n'existe : ne
     * jamais appeler avant d'avoir confirmé son existence via
     * `getLotLedger`.
     */
    getLotLedgerMargin: (lotId: string, organizationId: string) =>
      request<{ margin: string }>(`/api/procurement/lot-ledgers/${lotId}/margin/${toQueryString({ organization_id: organizationId })}`),

    /**
     * `POST /api/procurement/lot-ledgers/` (ticket B-035) — `prix_client`
     * saisi manuellement, `foncier_alloue`/`be_alloue` dérivés backend
     * (snapshot `ProgramCost`, jamais transmis ici). 409 si le devis du
     * lot n'est pas encore verrouillé (`LotDevisNotLockedError`), si un
     * grand-livre existe déjà (`LotLedgerAlreadyExistsError`), ou si le
     * partage foncier/BE échoue (`NoProgramCostError`/
     * `LotMissingSurfaceError`) — les quatre portent un `detail`
     * exploitable via `ApiError.detail`.
     */
    createLotLedger: (payload: { organization: string; lot: string; prix_client: string }) =>
      request<LotLedger>('/api/procurement/lot-ledgers/', { method: 'POST', json: payload }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
