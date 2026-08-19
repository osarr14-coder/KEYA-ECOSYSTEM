/**
 * Ticket 020 : reçoit une session transmise par l'écran de connexion
 * (`apps/web`) via fragment d'URL (`#access_token=...&refresh_token=...`)
 * — HOME/BUILD/CONTROL PWA sont des origines séparées (ports différents en
 * dev, aucune config de déploiement partagée dans ce repo) qui ne peuvent
 * pas partager `localStorage` directement ; le fragment est le seul canal
 * qui traverse la redirection sans jamais être envoyé au serveur ni
 * journalisé par un proxy.
 *
 * Remplace le mécanisme manuel documenté depuis les tickets 008/009
 * (`localStorage.setItem('keya_access_token', '<jwt>')` posé à la main) —
 * la persistance elle-même reste `localStorage`, sous la MÊME clé, pour ne
 * rien casser côté lecture (`getAccessToken` dans chaque client API).
 *
 * Appelée une seule fois, avant le premier rendu (`main.tsx`) — jamais à
 * l'intérieur d'un composant React, pour que le token soit déjà en
 * `localStorage` avant que `createApiClient` ne le lise.
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
