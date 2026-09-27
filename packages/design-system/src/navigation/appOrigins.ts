/**
 * Origines des 4 apps du monorepo, et construction d'une URL de transfert de
 * session entre elles — ticket F-040, promu ici depuis
 * `apps/web/src/auth/redirectTarget.ts` (tickets 020/021, seul consommateur
 * jusqu'ici) pour que les liens de sidebar `AppShell` inter-apps (BUILD ->
 * HOME, HOME -> BUILD/CONTROL) puissent réutiliser EXACTEMENT le même
 * mécanisme que la redirection post-connexion, plutôt que des chemins
 * relatifs qui restent sur la même origine (aucune de ces apps n'a de
 * routeur — voir le ticket pour le bug constaté en vérification manuelle).
 */
export interface AppOrigins {
  home: string;
  build: string;
  control: string;
  web: string;
}

/**
 * Lit les origines cibles depuis l'environnement (même convention que
 * `VITE_API_BASE_URL` ailleurs dans ce monorepo) — jamais codées en dur,
 * pour rester correctes quel que soit le déploiement réel (les 4 apps n'ont,
 * à ce jour, aucune config de déploiement partagée dans ce repo).
 */
export function resolveAppOrigins(): AppOrigins {
  return {
    home: import.meta.env.VITE_HOME_URL ?? 'http://localhost:5173',
    build: import.meta.env.VITE_BUILD_URL ?? 'http://localhost:5174',
    control: import.meta.env.VITE_CONTROL_URL ?? 'http://localhost:5175',
    web: import.meta.env.VITE_WEB_URL ?? 'http://localhost:5176',
  };
}

/**
 * Construit l'URL de transfert avec les jetons en fragment (`#...`), jamais
 * en query string (ticket 020) : un fragment n'est JAMAIS envoyé au serveur
 * ni journalisé par un proxy — seul le navigateur y accède, exactement ce
 * qu'il faut pour transférer une session entre deux origines qui ne
 * partagent pas `localStorage`. Lu une seule fois par l'app cible
 * (`receiveIncomingSession`), puis retiré de l'URL.
 */
export function buildCrossAppUrl(origin: string, accessToken: string, refreshToken: string): string {
  const params = new URLSearchParams({ access_token: accessToken, refresh_token: refreshToken });
  return `${origin}/#${params.toString()}`;
}


/** Clés de session partagées par les apps (chacune dans le `localStorage`
 * de SA propre origine). */
const SESSION_KEYS = ['keya_access_token', 'keya_refresh_token', 'keya_active_organization_id'];

/**
 * Ticket F-070 — déconnexion volontaire : aucune app n'en proposait (seule
 * la déconnexion forcée sur 401 existait, `forceLogout`), impossible donc de
 * changer de compte sans vider le stockage à la main. Efface la session de
 * l'origine COURANTE puis ouvre l'écran de connexion d'apps/web ; `?logout=1`
 * demande à apps/web d'effacer aussi la sienne (autre origine, autre
 * `localStorage`), sans quoi un jeton d'admin/ADV/Finance resté là rouvrirait
 * directement le back-office.
 */
export function logoutToLoginScreen(assign: (url: string) => void = (url) => window.location.assign(url)): void {
  for (const key of SESSION_KEYS) localStorage.removeItem(key);
  assign(`${resolveAppOrigins().web}/?logout=1`);
}

/** Côté apps/web, au démarrage : honore `?logout=1` (voir ci-dessus).
 * Retourne `true` si une déconnexion a été appliquée. */
export function consumeLogoutRequest(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get('logout') !== '1') return false;
  for (const key of SESSION_KEYS) localStorage.removeItem(key);
  url.searchParams.delete('logout');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}
