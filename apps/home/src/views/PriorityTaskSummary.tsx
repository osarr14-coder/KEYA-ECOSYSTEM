import { AlertBanner } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { useApiResource } from '../api/useApiResource';

export interface PriorityTaskSummaryProps {
  /** Bascule vers l'onglet "Mes actions" — le détail complet vit là,
   * jamais dupliqué ici (ce résumé n'affiche que titre + échéance). */
  onSeeAllActions: () => void;
  /** Ticket 019 — dans les deps de `useApiResource` ci-dessous : ce résumé
   * n'a pas de `lotId` pour déclencher un refetch naturellement lors d'un
   * changement d'organisation (contrairement à `OverviewView`), il lui faut
   * donc son propre signal explicite. */
  activeOrganizationId: string | null;
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'Aucune échéance';
  return new Date(dueDate).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/**
 * Résumé compact de la tâche la plus prioritaire, en Vue d'ensemble
 * (ticket 008 — élément « prochaine action » du critère produit 26.1).
 * Consomme EXACTEMENT le même endpoint que « Mes actions »
 * (`GET /api/me/tasks/`), avec `ordering=priority` — le tri (priorité puis
 * échéance) est calculé côté backend (`apps/tasks/views.py`), jamais
 * recalculé ici : ce composant ne fait que prendre le premier élément du
 * tableau déjà trié, aucune logique de sélection dupliquée.
 */
export function PriorityTaskSummary({ onSeeAllActions, activeOrganizationId }: PriorityTaskSummaryProps) {
  const api = useApiClient();
  const state = useApiResource(
    () => api.getMyTasks({ status: 'pending', ordering: 'priority' }),
    [activeOrganizationId],
  );

  if (state.status === 'loading') {
    return <p>Chargement…</p>;
  }
  if (state.status === 'error') {
    return <AlertBanner title="Impossible de charger vos actions." />;
  }

  const priorityTask = state.data[0] ?? null;

  return (
    <section aria-label="Prochaine action" data-testid="priority-task-summary">
      <h2 style={{ marginBottom: '8px' }}>Prochaine action</h2>
      {priorityTask ? (
        <div>
          <strong>{priorityTask.label}</strong>
          <p>Échéance : {formatDueDate(priorityTask.due_date)}</p>
          <button type="button" onClick={onSeeAllActions}>
            Voir toutes mes actions
          </button>
        </div>
      ) : (
        <p>Rien à faire pour l'instant.</p>
      )}
    </section>
  );
}
