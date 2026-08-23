import { useEffect, useState } from 'react';

import { MOBILE_BREAKPOINT_PX } from '../tokens/breakpoints';

const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

/**
 * Ticket F-050 — viewport en dessous du seuil mobile (`MOBILE_BREAKPOINT_PX`).
 * Pilote le rendu compact d'`AppShell` (voir `AppShell.tsx`,
 * `effectiveCollapsed`) — la partie du correctif exprimable en JS
 * (`gridTemplateColumns` reste un style inline, comme avant ce ticket,
 * jamais un `!important` CSS pour contourner un style inline existant).
 *
 * `window.matchMedia` est absent de `jsdom` (environnement de test, voir
 * `setupTests.ts`) — dégradation explicite à `false` plutôt qu'une
 * exception, même discipline défensive que `useOnlineStatus` face à un
 * environnement sans `navigator.onLine` fiable. Conséquence assumée et
 * documentée (F-050) : tous les tests `AppShell.test.tsx` existants
 * restent verts SANS modification, ce hook y retournant toujours `false`.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
      : false
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQueryList = window.matchMedia(MOBILE_MEDIA_QUERY);

    function handleChange(event: MediaQueryListEvent) {
      setIsMobile(event.matches);
    }

    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}
