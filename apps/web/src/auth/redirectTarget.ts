import {
  buildCrossAppUrl, resolveAppOrigins, type AppOrigins,
} from '@keya/design-system';

import type { Me } from '../api/types';

// Ticket F-040 — `AppOrigins`/`resolveAppOrigins` (et `buildCrossAppUrl`,
// utilisée plus bas par `buildRedirectUrl`) ont migré vers
// `@keya/design-system` : les liens de sidebar `AppShell` inter-apps (BUILD
// -> HOME, HOME -> BUILD/CONTROL) en ont désormais besoin eux aussi, jamais
// une seconde copie. Ré-exportées ici pour ne rien casser côté appelants
// existants de ce module.
export { resolveAppOrigins };
export type { AppOrigins };

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
 * Nom conservé pour ne rien casser côté appelants existants (`App.tsx`,
 * tests) — délègue à `buildCrossAppUrl` (ticket F-040, `@keya/design-system`),
 * même logique exacte, jamais dupliquée.
 */
export function buildRedirectUrl(origin: string, accessToken: string, refreshToken: string): string {
  return buildCrossAppUrl(origin, accessToken, refreshToken);
}
