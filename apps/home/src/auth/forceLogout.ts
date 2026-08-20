/**
 * Ticket F-033 (vague 4) — un 401 en cours de session (voir
 * `ApiClientConfig.onUnauthorized`, `api/client.ts`) signifie que le jeton
 * détenu est définitivement mort (session expirée, compte désactivé
 * mid-session — ticket 011). Cette app n'héberge AUCUN écran de connexion
 * propre (ticket 020 : seule `apps/web` en a un) — la seule destination
 * valable est donc `apps/web` elle-même, jamais un état interne qui
 * laisserait l'utilisateur bloqué avec un jeton mort et sans moyen de se
 * réauthentifier.
 */
export function forceLogout(): void {
  localStorage.removeItem('keya_access_token');
  const webUrl = import.meta.env.VITE_WEB_URL ?? 'http://localhost:5176';
  window.location.href = `${webUrl}/`;
}
