import {
  AlertBanner, ApiErrorBanner, Card, TrustEventLine,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { toTrustEventData } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { ProgramHeroCard } from '../components/ProgramHeroCard';
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
  /** Ticket 019 — transmis tel quel à `PriorityTaskSummary`, qui n'a pas de
   * `lotId` pour déclencher son propre refetch lors d'un changement
   * d'organisation. */
  activeOrganizationId: string | null;
}

export function OverviewView({ lotId, onSeeAllActions, activeOrganizationId }: OverviewViewProps) {
  const api = useApiClient();
  const state = useApiResource(() => api.getLotOverview(lotId), [lotId]);

  if (state.status === 'loading') {
    return <p>Chargement…</p>;
  }
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger votre bien." onRetry={state.refetch} />;
  }

  const overview = state.data;

  return (
    <section aria-label="Vue d'ensemble" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Ticket F-033 (vague 4) — cet écran n'avait AUCUN moyen de tirer des
          données fraîches une fois chargées : ni sondage périodique (aucun
          écran de ce projet n'en a), ni action visible — seule une
          navigation hors de l'écran puis un retour déclenchait un nouveau
          chargement (démontage/remontage). `state.refetch` (ticket F-033
          vague 3) existait déjà mais n'était utilisé que sur l'état
          d'erreur. Action manuelle, jamais un sondage automatique en
          arrière-plan, et honnête : rien ne garantit qu'une donnée soit
          RÉELLEMENT périmée, seulement que l'utilisateur peut désormais
          vérifier explicitement plutôt que de ne jamais savoir. */}
      <ProgramHeroCard
        programName={overview.program_name}
        assetName={overview.asset_name}
        lotName={overview.lot_name}
        assetLocation={overview.asset_location}
        onRefresh={state.refetch}
      />

      <Card aria-label="Progression" data-testid="progress" title="Progression" icon="building">
        {/* PO-2026-09-28-14 (CDC §1) : un compte reçu de l'API, jamais un
            pourcentage ni une jauge dérivés des niveaux de confiance. */}
        <p style={{ margin: 0 }}>
          {`${overview.accepted_milestone_count} / ${overview.milestone_count} jalons acceptés techniquement`}
        </p>
      </Card>

      <Card aria-label="Dernier événement notable" title="Dernier événement" icon="check-circle">
        {overview.latest_notable_event ? (
          // PO-2026-09-28-04 : niveau en ligne datée et attribuée, jamais en badge.
          <TrustEventLine event={toTrustEventData(overview.latest_notable_event)} />
        ) : (
          <p>Aucun événement pour le moment.</p>
        )}
      </Card>

      {overview.open_reserve && (
        <div data-testid="open-reserve">
          <AlertBanner title={OPEN_RESERVE_STATUS_LABELS[overview.open_reserve.status] ?? 'Réserve en cours'}>
            {overview.open_reserve.description}
          </AlertBanner>
        </div>
      )}

      <PriorityTaskSummary onSeeAllActions={onSeeAllActions} activeOrganizationId={activeOrganizationId} />
    </section>
  );
}
