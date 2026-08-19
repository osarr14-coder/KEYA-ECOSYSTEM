import type { Me } from '../api/types';

export interface AppOrigins {
  home: string;
  build: string;
  control: string;
}

/**
 * Lit les origines cibles depuis l'environnement (même convention que
 * `VITE_API_BASE_URL` ailleurs dans ce monorepo) — jamais codées en dur,
 * pour rester correctes quel que soit le déploiement réel (les 3 apps
 * n'ont, à ce jour, aucune config de déploiement partagée dans ce repo).
 */
export function resolveAppOrigins(): AppOrigins {
  return {
    home: import.meta.env.VITE_HOME_URL ?? 'http://localhost:5173',
    build: import.meta.env.VITE_BUILD_URL ?? 'http://localhost:5174',
    control: import.meta.env.VITE_CONTROL_URL ?? 'http://localhost:5175',
  };
}

/**
 * Résout l'app cible à partir du RÔLE de la PREMIÈRE membership renvoyée par
 * `/me` — même convention que le fallback déjà utilisé par l'App Switcher
 * (ticket 019, `apps/{home,build}/src/App.tsx`) et par le comportement par
 * défaut du backend lui-même quand aucun `X-Organization-Id` n'est fourni
 * (`apps.core.middleware.OrganizationScopeMiddleware._resolve_organization`,
 * membership la plus ancienne) : à ce stade (connexion), aucune organisation
 * n'a encore été choisie, donc aucune autre source de vérité n'existe.
 *
 * Mapping délibéré, documenté (ticket 020) : `inspecteur` → CONTROL (app
 * mobile dédiée, ticket 010), `constructeur` → BUILD (Control Tower
 * professionnel, ticket 009), TOUT AUTRE RÔLE (`client`, `sponsor`,
 * `admin_keyimmo`, ou aucune membership) → HOME, l'app générale — aucun des
 * deux autres rôles n'a d'app dédiée aujourd'hui (`FINANCE`/`NOTARY`,
 * modules `AppShell` du ticket 007, jamais déployés comme apps réelles).
 */
export function resolveRedirectApp(me: Me): keyof AppOrigins {
  const primaryRole = me.memberships[0]?.role_code;
  if (primaryRole === 'inspecteur') return 'control';
  if (primaryRole === 'constructeur') return 'build';
  return 'home';
}

/**
 * Construit l'URL de redirection avec les jetons en fragment (`#...`),
 * jamais en query string (ticket 020) : un fragment n'est JAMAIS envoyé au
 * serveur ni journalisé par un proxy/reverse-proxy — seul le navigateur y
 * accède, exactement ce qu'il faut pour un transfert de session ponctuel
 * entre deux origines qui ne partagent pas `localStorage`. Lu une seule
 * fois par l'app cible (`receiveIncomingSession`), puis retiré de l'URL.
 */
export function buildRedirectUrl(origin: string, accessToken: string, refreshToken: string): string {
  const params = new URLSearchParams({ access_token: accessToken, refresh_token: refreshToken });
  return `${origin}/#${params.toString()}`;
}
