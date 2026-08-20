/**
 * Ticket F-033 (vague 4) — un 401 en cours de session (voir
 * `ApiClientConfig.onUnauthorized`, `api/client.ts`) signifie que le jeton
 * détenu est définitivement mort (session expirée, compte désactivé
 * mid-session — ticket 011). Contrairement à `apps/{home,build}`, cette
 * app héberge SON PROPRE écran de connexion (ticket 020) : nul besoin de
 * rediriger ailleurs. Un rechargement complet de SON PROPRE origine
 * suffit — `App.tsx::App` lit `storedAccessToken` UNE SEULE FOIS à
 * l'initialisation (`useState(() => ...)`, jamais réactif à un changement
 * de `localStorage`), donc seul un vrai rechargement de document fait
 * réapparaître l'écran de connexion une fois le jeton effacé.
 */
export function forceLogout(): void {
  localStorage.removeItem('keya_access_token');
  window.location.href = '/';
}
