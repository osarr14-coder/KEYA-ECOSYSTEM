import { useEffect, useState } from 'react';

import {
  AlertBanner, densityTokens, ProgressBar, semanticColors, type Density,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { AllLotsQuery } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { fetchAllLotRows } from '../export/fetchAllLotRows';
import { buildLotsCsv, buildLotsExportFilename, downloadCsv } from '../export/lotsCsvExport';

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
 * Ticket F-032 — page_size utilisé POUR L'EXPORT uniquement (distinct de
 * `PAGE_SIZE`, celui de l'écran) : le maximum autorisé côté backend
 * (`LotPagination.max_page_size`, apps/build/pagination.py) — minimise le
 * nombre de requêtes nécessaires pour reconstituer le jeu filtré/trié
 * complet.
 */
const EXPORT_PAGE_SIZE = 100;

/**
 * Au-delà de ce nombre de requêtes, l'export prévient l'utilisateur AVANT
 * de le lancer plutôt que de le laisser attendre sans explication (demande
 * explicite, ticket F-032) — un clic supplémentaire suffit à confirmer.
 */
const EXPORT_REQUEST_WARNING_THRESHOLD = 10;

type ExportState =
  | { status: 'idle' }
  | { status: 'confirming'; requestCount: number; totalCount: number }
  | { status: 'exporting' }
  | { status: 'error' };

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
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

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

  /**
   * Ticket F-032 — l'export doit refléter ce que l'utilisateur voit à
   * l'écran APRÈS filtre/tri, jamais la page seule ni un dump brut : même
   * `ordering`/`q`/`assigned` que l'écran, mais SANS `page`/`page_size`
   * (`fetchAllLotRows` les pose lui-même, page par page, à
   * `EXPORT_PAGE_SIZE`).
   */
  async function runExport() {
    setExportState({ status: 'exporting' });
    try {
      const exportQuery: AllLotsQuery = {
        ordering, q: search || undefined, assigned: assignedFilter || undefined,
      };
      const rows = await fetchAllLotRows(api.getAllLots, exportQuery, EXPORT_PAGE_SIZE);
      downloadCsv(buildLotsExportFilename(new Date()), buildLotsCsv(rows));
      setExportState({ status: 'idle' });
    } catch {
      setExportState({ status: 'error' });
    }
  }

  function handleExportClick() {
    if (state.status !== 'success') return;
    const totalCount = state.data.count;
    const requestCount = Math.max(1, Math.ceil(totalCount / EXPORT_PAGE_SIZE));
    if (requestCount > EXPORT_REQUEST_WARNING_THRESHOLD) {
      setExportState({ status: 'confirming', requestCount, totalCount });
      return;
    }
    void runExport();
  }

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

      <div style={{ marginBottom: '12px' }}>
        <button
          type="button"
          onClick={handleExportClick}
          disabled={state.status !== 'success' || exportState.status === 'exporting'}
        >
          {exportState.status === 'exporting' ? 'Export en cours…' : 'Exporter en CSV'}
        </button>

        {exportState.status === 'confirming' && (
          <AlertBanner title={`Export volumineux : ${exportState.totalCount} lot(s), ${exportState.requestCount} requêtes nécessaires.`}>
            <p>Cela peut prendre un moment. Continuer ?</p>
            <button type="button" onClick={() => void runExport()}>Continuer l&apos;export</button>
            <button type="button" onClick={() => setExportState({ status: 'idle' })}>Annuler</button>
          </AlertBanner>
        )}

        {exportState.status === 'error' && (
          <AlertBanner title="Échec de l'export CSV. Réessayez." />
        )}
      </div>

      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && <AlertBanner title="Impossible de charger les lots." />}

      {state.status === 'success' && (
        <>
          {state.data.results.length === 0 ? (
            <p>Aucun lot ne correspond à ces critères.</p>
          ) : (
            <table style={{ fontSize: tokens.fontSize, borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
                  <th style={{ textAlign: 'left', padding: `${tokens.paddingBlock} ${tokens.paddingInline}` }}>Nom</th>
                  <th style={{ textAlign: 'left' }}>Bien</th>
                  <th style={{ textAlign: 'left' }}>Programme</th>
                  <th style={{ textAlign: 'left' }}>Organisation constructrice</th>
                  <th style={{ textAlign: 'left' }}>Jalons déclarés</th>
                  <th style={{ textAlign: 'left' }}>Avancement</th>
                  <th style={{ textAlign: 'left' }}>Réserves ouvertes</th>
                </tr>
              </thead>
              <tbody>
                {state.data.results.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="lot-row"
                    style={{ height: tokens.rowHeight, borderBottom: `1px solid ${semanticColors.neutral.border}` }}
                  >
                    <td style={{ padding: `${tokens.paddingBlock} ${tokens.paddingInline}` }}>{row.name}</td>
                    <td>{row.asset_name}</td>
                    <td>{row.program_name}</td>
                    <td>{row.assigned_organization_name ?? '—'}</td>
                    <td>{row.declared_milestone_count}/{row.milestone_count}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ProgressBar percentage={row.progress_percentage} width="60px" />
                        <span>{row.progress_percentage}%</span>
                      </div>
                    </td>
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
