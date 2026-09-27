import { useEffect, useState } from 'react';

/**
 * Ticket F-079 — navigation des pages publiques (accueil `/`, connexion
 * `/connexion`, inscription `/inscription`) : `pushState` + `popstate`, même
 * principe que `useUrlSyncedTab` (aucun routeur ajouté), bouton retour du
 * navigateur fonctionnel.
 */
export const PUBLIC_PATHS = ['/', '/connexion', '/inscription'] as const;
export type PublicPath = (typeof PUBLIC_PATHS)[number];

function currentPath(): PublicPath {
  const { pathname } = window.location;
  return (PUBLIC_PATHS as readonly string[]).includes(pathname) ? pathname as PublicPath : '/';
}

export function usePublicPath(): [PublicPath, (path: PublicPath) => void] {
  const [path, setPath] = useState<PublicPath>(currentPath);

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(next: PublicPath) {
    if (next !== window.location.pathname) window.history.pushState(null, '', next);
    setPath(next);
    // jsdom n'implémente pas `scrollTo` (tests) : jamais bloquant.
    if (!navigator.userAgent.includes('jsdom')) window.scrollTo(0, 0);
  }

  return [path, navigate];
}
