import { useEffect, useState } from 'react';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; data: T };

/** Ticket F-033 (vague 3) — `refetch()` redéclenche `load()` sans changer
 * les `deps` fournis par l'appelant : sert un bouton "Réessayer" générique
 * sur une erreur de chargement (`AlertBanner`), sans dupliquer un
 * `reloadKey` local à chaque écran consommateur. */
export type ApiResourceState<T> = ResourceState<T> & { refetch: () => void };

/**
 * Charge une ressource via le client API et expose son état de chargement —
 * pure plomberie React (loading/success/error), aucune transformation de la
 * donnée reçue (voir critère d'acceptation ticket 008).
 */
export function useApiResource<T>(load: () => Promise<T>, deps: unknown[]): ApiResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    load()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  return { ...state, refetch: () => setReloadToken((token) => token + 1) };
}
