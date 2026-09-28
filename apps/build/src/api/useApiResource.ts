import { useEffect, useRef, useState } from 'react';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; data: T };

/** Ticket F-033 (vague 3) — `refetch()` redéclenche `load()` sans changer
 * les `deps` fournis par l'appelant : sert un bouton "Réessayer" générique
 * sur une erreur de chargement (`AlertBanner`), sans dupliquer un
 * `reloadKey` local à chaque écran consommateur. */
export type ApiResourceState<T> = ResourceState<T> & { refetch: () => void };

/** PO-2026-09-28-51 (A2, lot 1 « Cohérence ») : un même objet affiche le même
 * état chez tous les rôles sans rechargement manuel. Toute ressource affichée
 * se recharge discrètement (sans repasser par « chargement ») :
 * - immédiatement après chaque action réussie de l'utilisateur (le client API
 *   publie `DATA_CHANGED_EVENT` après toute requête d'écriture) ;
 * - au retour sur la fenêtre (autre rôle, autre fenêtre) ;
 * - toutes les 15 s tant que l'onglet est visible. */
export const DATA_CHANGED_EVENT = 'keya:data-changed';
export const LIVE_REFRESH_INTERVAL_MS = 15_000;

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

/** Même utilitaire que `apps/home/src/api/useApiResource.ts` — pure
 * plomberie React, aucune transformation de la donnée reçue. */
export function useApiResource<T>(load: () => Promise<T>, deps: unknown[]): ApiResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  // Rafraîchissement discret (PO-2026-09-28-51) : toujours la DERNIÈRE
  // fonction `load` (ses `deps` à jour), jamais pendant un chargement
  // principal, et un chargement principal plus récent l'emporte toujours.
  const loadRef = useRef(load);
  loadRef.current = load;
  const primaryRun = useRef(0);
  const primaryPending = useRef(true);
  const silentRun = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const run = ++primaryRun.current;
    primaryPending.current = true;
    setState({ status: 'loading' });
    load()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error });
      })
      .finally(() => {
        if (run === primaryRun.current) primaryPending.current = false;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  useEffect(() => {
    let unmounted = false;
    function refreshSilently() {
      if (unmounted || primaryPending.current || document.visibilityState === 'hidden') return;
      const primary = primaryRun.current;
      const run = ++silentRun.current;
      loadRef
        .current()
        .then((data) => {
          if (unmounted || primary !== primaryRun.current || run !== silentRun.current) return;
          // Même contenu : aucun nouveau rendu (pas de clignotement).
          setState((previous) =>
            previous.status === 'success' && sameContent(previous.data, data) ? previous : { status: 'success', data },
          );
        })
        // Échec d'un rafraîchissement discret : l'écran garde ce qu'il
        // affiche ; la tentative suivante (action, retour, 15 s) reprendra.
        .catch(() => undefined);
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refreshSilently();
    }
    window.addEventListener(DATA_CHANGED_EVENT, refreshSilently);
    window.addEventListener('focus', refreshSilently);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const timer = window.setInterval(refreshSilently, LIVE_REFRESH_INTERVAL_MS);
    return () => {
      unmounted = true;
      window.removeEventListener(DATA_CHANGED_EVENT, refreshSilently);
      window.removeEventListener('focus', refreshSilently);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, []);

  return { ...state, refetch: () => setReloadToken((token) => token + 1) };
}

function sameContent(previous: unknown, next: unknown): boolean {
  try {
    return JSON.stringify(previous) === JSON.stringify(next);
  } catch {
    return false;
  }
}
