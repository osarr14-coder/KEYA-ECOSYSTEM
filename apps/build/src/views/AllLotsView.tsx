import { useEffect, useState } from 'react';

import { densityTokens, type Density } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { AllLotsQuery } from '../api/types';
import { useApiResource } from '../api/useApiResource';

export interface AllLotsViewProps {
  /** Préremplit la recherche — utilisé par le lien "Voir dans Tous les
   * lots" des exceptions (navigation réelle, pas un lien mort). */
  initialSearch?: string;
  /** Ticket 019 — dans les deps de `useApiResource` ci-dessous : cette vue
   * n'a pas d'autre signal pour déclencher un refetch lors d'un changement
   * d'organisation (App Switcher). */
  activeOrganizationId: string | null;
}

const ORDERING_OPTIONS: { value: string; label: string }[] = [
  { value: 'name', label: 'Nom (A→Z)' },
  { value: '-name', label: 'Nom (Z→A)' },
  { value: '-created_at', label: 'Plus récent' },
  { value: 'created_at', label: 'Plus ancien' },
  { value: '-progress_percentage', label: 'Avancement (décroissant)' },
  { value: 'progress_percentage', label: 'Avancement (croissant)' },
  { value: '-open_reserve_count', label: 'Réserves ouvertes (décroissant)' },
];

const PAGE_SIZE = 25;

/**
 * Tableau « Tous les lots » (ticket 009) — écran d'usage intensif : tri,
 * filtres, pagination et densité réglable, PAS de version simplifiée. Tri/
 * filtre/pagination sont transmis en query params à
 * `GET /api/build/lots/`, entièrement appliqués côté backend (voir
 * apps/build/views.py) — ce composant ne fait qu'afficher la page reçue.
 */
export function AllLotsView({ initialSearch = '', activeOrganizationId }: AllLotsViewProps) {
  const api = useApiClient();
  const [search, setSearch] = useState(initialSearch);
  const [ordering, setOrdering] = useState('name');
  const [assignedFilter, setAssignedFilter] = useState<'' | 'true' | 'false'>('');
  const [density, setDensity] = useState<Density>('dense');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setSearch(initialSearch);
    setPage(1);
  }, [initialSearch]);

  const query: AllLotsQuery = {
    ordering,
    q: search || undefined,
    assigned: assignedFilter || undefined,
    page,
    page_size: PAGE_SIZE,
  };
  const state = useApiResource(
    () => api.getAllLots(query),
    [ordering, search, assignedFilter, page, activeOrganizationId],
  );

  const tokens = densityTokens[density];

  return (
    <section aria-label="Tous les lots">
      <form
        role="search"
        onSubmit={(event) => event.preventDefault()}
        style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}
      >
        <label>
          Rechercher
          <input
            type="search"
            aria-label="Rechercher un lot"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          />
        </label>

        <label>
          Trier par
          <select
            aria-label="Trier par"
            value={ordering}
            onChange={(event) => { setOrdering(event.target.value); setPage(1); }}
          >
            {ORDERING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label>
          Organisation affectée
          <select
            aria-label="Filtrer par affectation"
            value={assignedFilter}
            onChange={(event) => {
              setAssignedFilter(event.target.value as '' | 'true' | 'false');
              setPage(1);
            }}
          >
            <option value="">Tous</option>
            <option value="true">Affectés</option>
            <option value="false">Non affectés</option>
          </select>
        </label>

        <div role="group" aria-label="Densité du tableau">
          <button
            type="button" aria-pressed={density === 'dense'}
            onClick={() => setDensity('dense')}
          >
            Dense
          </button>
          <button
            type="button" aria-pressed={density === 'confortable'}
            onClick={() => setDensity('confortable')}
          >
            Confortable
          </button>
        </div>
      </form>

      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && <p role="alert">Impossible de charger les lots.</p>}

      {state.status === 'success' && (
        <>
          {state.data.results.length === 0 ? (
            <p>Aucun lot ne correspond à ces critères.</p>
          ) : (
            <table style={{ fontSize: tokens.fontSize, borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Bien</th>
                  <th>Programme</th>
                  <th>Organisation constructrice</th>
                  <th>Jalons déclarés</th>
                  <th>Avancement</th>
                  <th>Réserves ouvertes</th>
                </tr>
              </thead>
              <tbody>
                {state.data.results.map((row) => (
                  <tr key={row.id} data-testid="lot-row" style={{ height: tokens.rowHeight }}>
                    <td style={{ padding: `${tokens.paddingBlock} ${tokens.paddingInline}` }}>{row.name}</td>
                    <td>{row.asset_name}</td>
                    <td>{row.program_name}</td>
                    <td>{row.assigned_organization_name ?? '—'}</td>
                    <td>{row.declared_milestone_count}/{row.milestone_count}</td>
                    <td>{row.progress_percentage}%</td>
                    <td>{row.open_reserve_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div aria-label="Pagination" style={{ marginTop: '8px' }}>
            <span>{state.data.count} lot(s)</span>
            <button
              type="button" disabled={!state.data.previous}
              onClick={() => setPage((current) => current - 1)}
            >
              Précédent
            </button>
            <button
              type="button" disabled={!state.data.next}
              onClick={() => setPage((current) => current + 1)}
            >
              Suivant
            </button>
          </div>
        </>
      )}
    </section>
  );
}
