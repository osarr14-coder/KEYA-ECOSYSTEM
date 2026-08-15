import { AlertBanner, StatusBadge } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { toTrustEventData } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { PriorityTaskSummary } from './PriorityTaskSummary';

// Libellés d'affichage pour `open_reserve.status` (une des sources
// `apps.inspections.services.get_reserve_status`, PAS un TrustLevel — ne
// convient donc pas à StatusBadge, qui n'accepte que les 5 niveaux Visible
// Trust). Purement cosmétique : aucune donnée n'est calculée ici, seule sa
// présentation textuelle.
const OPEN_RESERVE_STATUS_LABELS: Record<string, string> = {
  ouverte: 'Réserve ouverte',
  correction_proposee: 'Correction proposée — en attente de nouvelle inspection',
  nouvelle_inspection: 'Nouvelle inspection en cours',
};

export interface OverviewViewProps {
  lotId: string;
  /** Bascule vers l'onglet "Mes actions" — transmis tel quel au résumé de
   * la tâche prioritaire (`PriorityTaskSummary`). */
  onSeeAllActions: () => void;
}

export function OverviewView({ lotId, onSeeAllActions }: OverviewViewProps) {
  const api = useApiClient();
  const state = useApiResource(() => api.getLotOverview(lotId), [lotId]);

  if (state.status === 'loading') {
    return <p>Chargement…</p>;
  }
  if (state.status === 'error') {
    return <p role="alert">Impossible de charger votre bien.</p>;
  }

  const overview = state.data;

  return (
    <section aria-label="Vue d'ensemble">
      <header data-testid="hero">
        <h1>{overview.asset_name}</h1>
        <p>{overview.program_name} — {overview.lot_name}</p>
        <p>{overview.asset_location}</p>
      </header>

      <div aria-label="Progression" data-testid="progress">
        <div style={{ background: '#E5E7EB', borderRadius: 999, overflow: 'hidden', height: 8, width: 200 }}>
          <div
            data-testid="progress-bar-fill"
            style={{ width: `${overview.progress_percentage}%`, background: '#34D399', height: '100%' }}
          />
        </div>
        {/* Le pourcentage affiché est EXACTEMENT `progress_percentage` reçu
            de l'API — aucune opération arithmétique n'est faite ici. */}
        <p>{overview.progress_percentage}% d'avancement</p>
      </div>

      <div aria-label="Dernier événement notable">
        <h2>Dernier événement</h2>
        {overview.latest_notable_event ? (
          <StatusBadge
            level={overview.latest_notable_event.level}
            event={toTrustEventData(overview.latest_notable_event)}
          />
        ) : (
          <p>Aucun événement pour le moment.</p>
        )}
      </div>

      {overview.open_reserve && (
        <div data-testid="open-reserve">
          <AlertBanner title={OPEN_RESERVE_STATUS_LABELS[overview.open_reserve.status] ?? 'Réserve en cours'}>
            {overview.open_reserve.description}
          </AlertBanner>
        </div>
      )}

      <PriorityTaskSummary onSeeAllActions={onSeeAllActions} />
    </section>
  );
}
