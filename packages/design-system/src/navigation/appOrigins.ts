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
