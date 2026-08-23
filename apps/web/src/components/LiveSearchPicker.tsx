import {
  type ReactNode, useEffect, useRef, useState,
} from 'react';

import { ApiErrorBanner, Button, Input } from '@keya/design-system';

/**
 * Extrait de `DevisView.tsx` (ticket 027/B-028) au ticket F-049, une fois
 * `ProgramsView.tsx` devenu un troisième consommateur (après `LotPicker` et
 * `OrganizationPicker`, tous deux toujours dans `DevisView.tsx`) — même
 * discipline anti-duplication que le reste du projet (voir
 * `buildCrossAppUrl`, ticket F-040). Comportement strictement inchangé,
 * `DevisView.tsx` importe désormais depuis ce fichier.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Debounce + garde de réponse périmée : un `clearTimeout` seul n'annule que
 * les requêtes pas encore PARTIES — une requête déjà en vol quand une
 * frappe plus récente la dépasse doit encore être ignorée à sa résolution,
 * jamais appliquée par-dessus un résultat plus frais (même discipline anti-
 * course que `syncEngine.ts`, CONTROL PWA, tickets 015/016 : comparer l'état
 * réel au moment de la résolution, pas seulement au moment du départ).
 */
export function useDebouncedSearch<T>(searchFn: (query: string) => Promise<T[]>, query: string) {
  const [results, setResults] = useState<T[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  // Ticket F-033 (vague 4) — brute conservée pour distinguer un 403 (accès
  // refusé, jamais retentable) du reste, voir `ApiErrorBanner`.
  const [error, setError] = useState<unknown>(null);
  // Ticket F-033 (vague 3) — même principe que `useApiResource.refetch()` :
  // un compteur inclus dans les deps de l'effet, pour qu'un bouton
  // "Réessayer" relance EXACTEMENT la même recherche sans dupliquer sa
  // logique. Toujours au travers du MÊME debounce (250ms, imperceptible) —
  // jamais un second chemin direct qui contournerait les gardes anti-course
  // ci-dessous (`cancelled`/`latestQueryRef`).
  const [reloadToken, setReloadToken] = useState(0);
  const latestQueryRef = useRef(query);

  useEffect(() => {
    let cancelled = false;
    latestQueryRef.current = query;
    const trimmed = query.trim();

    if (!trimmed) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }

    setStatus('loading');
    const timeoutId = setTimeout(() => {
      searchFn(trimmed)
        .then((data) => {
          if (cancelled || latestQueryRef.current !== query) return;
          setResults(data);
          setStatus('success');
        })
        .catch((caughtError: unknown) => {
          if (cancelled || latestQueryRef.current !== query) return;
          setStatus('error');
          setError(caughtError);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchFn, reloadToken]);

  return {
    results, status, error, retry: () => setReloadToken((token) => token + 1),
  };
}

/**
 * Sélecteur générique par recherche en direct — partagé entre lot,
 * organisation candidate (`DevisView.tsx`) et organisation cible d'un
 * programme (`ProgramsView.tsx`), seuls le libellé, la fonction de
 * recherche et le rendu d'un résultat diffèrent.
 */
export function LiveSearchPicker<T>({
  label, placeholder, searchFn, renderResult, getKey, onSelect,
}: {
  label: string;
  placeholder: string;
  searchFn: (query: string) => Promise<T[]>;
  renderResult: (item: T) => ReactNode;
  getKey: (item: T) => string;
  onSelect: (item: T) => void;
}) {
  const [query, setQuery] = useState('');
  const {
    results, status, error, retry,
  } = useDebouncedSearch(searchFn, query);

  return (
    <div>
      <label>
        {label}
        <Input
          type="search"
          aria-label={label}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          style={{ marginTop: '4px', width: '360px' }}
        />
      </label>
      {status === 'loading' && <p style={{ fontSize: '13px' }}>Recherche…</p>}
      {status === 'error' && (
        <ApiErrorBanner error={error} title="Impossible d'effectuer la recherche." onRetry={retry} />
      )}
      {status === 'success' && results.length === 0 && (
        <p data-testid="no-search-results" style={{ fontSize: '13px' }}>Aucun résultat.</p>
      )}
      {status === 'success' && results.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '4px' }}>
          {results.map((item) => (
            <li key={getKey(item)}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onSelect(item)}
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
              >
                {renderResult(item)}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
