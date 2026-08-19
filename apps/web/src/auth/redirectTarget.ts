import type { Me } from '../api/types';

export interface AppOrigins {
  home: string;
  build: string;
  control: string;
  /** Ticket 021 — apps/web devient elle-même une destination possible (le
   * back-office), pas seulement le point d'entrée qui redirige toujours
   * ailleurs. Voir `resolveRedirectApp` ci-dessous. */
  web: string;
}

/**
 * Lit les origines cibles depuis l'environnement (même convention que
 * `VITE_API_BASE_URL` ailleurs dans ce monorepo) — jamais codées en dur,
 * pour rester correctes quel que soit le déploiement réel (les 4 apps
 * n'ont, à ce jour, aucune config de déploiement partagée dans ce repo).
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
 *
 * **Mise à jour ticket 021** : `admin_keyimmo` gagne sa propre branche →
 * `web` (apps/web héberge désormais le back-office, ticket 021 —
 * `021-backoffice-web.md`). CE N'EST PAS UN OUBLI du ticket 020 : à ce
 * moment-là, `apps/web` n'avait aucun écran post-connexion (uniquement le
 * formulaire de connexion), donc aucune destination `web` ne pouvait
 * exister — `admin_keyimmo` retombait alors, comme tout rôle sans app
 * dédiée, sur HOME par défaut. Voir `020-ecran-connexion.md`, section
 * « Évolution ticket 021 », pour la note explicite côté ticket d'origine.
 * « TOUT AUTRE RÔLE → HOME » reste vrai pour chaque rôle SAUF
 * `admin_keyimmo` désormais.
 */
export function resolveRedirectApp(me: Me): keyof AppOrigins {
  const primaryRole = me.memberships[0]?.role_code;
  if (primaryRole === 'inspecteur') return 'control';
  if (primaryRole === 'constructeur') return 'build';
  if (primaryRole === 'admin_keyimmo') return 'web';
  return 'home';
}

/**
 * Ticket 021 — bug réel trouvé en vérifiant le parcours `admin_keyimmo`
 * dans un vrai navigateur (jamais reproductible par les tests unitaires,
 * qui injectent un `redirect` mocké) : une redirection vers HOME/BUILD/
 * CONTROL change d'ORIGINE, donc `window.location.assign(url)` déclenche
 * TOUJOURS un rechargement complet du document — mais une redirection
 * `admin_keyimmo` vers apps/web ELLE-MÊME ne change que le FRAGMENT de
 * l'URL (même origine, même chemin). Un changement de fragment seul ne
 * recharge JAMAIS le document (comportement standard des navigateurs,
 * identique à un simple lien d'ancre `#...`) : `main.tsx` ne rejouait donc
 * jamais `receiveIncomingSession()`, laissant l'écran de connexion affiché
 * indéfiniment malgré un token réel désormais dans l'URL. Voir `App.tsx`
 * (`defaultRedirect`), qui utilise cette fonction pour forcer un vrai
 * rechargement dans ce cas précis, jamais pour les 3 autres (déjà
 * rechargées par la navigation cross-origine elle-même).
 */
export function isSameOriginRedirect(targetUrl: string, currentHref: string): boolean {
  return new URL(targetUrl, currentHref).origin === new URL(currentHref).origin;
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
