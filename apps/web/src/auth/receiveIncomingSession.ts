/**
 * Ticket 021 : apps/web devient elle-même une destination de redirection
 * possible (`admin_keyimmo` → 'web', voir `redirectTarget.ts`) — jusqu'ici
 * elle ne faisait que PRODUIRE ce fragment pour HOME/BUILD/CONTROL PWA
 * (ticket 020), jamais le CONSOMMER. Reprend exactement le même mécanisme
 * déjà en place dans les 3 autres apps (`apps/{home,build,control-pwa}/src/
 * auth/receiveIncomingSession.ts`) — dupliqué plutôt que partagé, même
 * discipline déjà assumée pour `createApiClient` entre apps (ticket 020).
 *
 * Un aller-retour `admin_keyimmo` reste un cas normal de ce mécanisme, pas
 * un cas spécial : `buildRedirectUrl`/`redirect()` ne savent pas que la
 * cible EST l'origine courante — c'est une vraie navigation comme les
 * autres, qui redéclenche `main.tsx` depuis zéro.
 *
 * Appelée une seule fois, avant le premier rendu (`main.tsx`) — jamais à
 * l'intérieur d'un composant React, pour que le token soit déjà en
 * `localStorage` avant que `App` ne décide quel écran afficher.
 */
export function receiveIncomingSession(): void {
  if (!window.location.hash) return;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get('access_token');
  if (!accessToken) return;

  localStorage.setItem('keya_access_token', accessToken);
  const refreshToken = params.get('refresh_token');
  if (refreshToken) localStorage.setItem('keya_refresh_token', refreshToken);

  // Retire le fragment de l'URL — jamais laisser un jeton visible dans la
  // barre d'adresse ou l'historique de navigation une fois consommé.
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(null, '', url.toString());
}
