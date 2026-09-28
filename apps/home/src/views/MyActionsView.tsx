import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { Task } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/** PO-2026-09-28-44 (P33) — une entrée du circuit d'achat ouvre « Mon
 * acquisition », où l'action se mène. */
export function opensAcquisition(task: Task) {
  const source = task.source.split(':')[0];
  return source.startsWith('payment_') || source.startsWith('reservation_');
}

export interface MyActionsViewProps {
  /** Ticket 019 — dans les deps de `useApiResource` ci-dessous : cette vue
   * n'a pas de `lotId` pour déclencher un refetch naturellement lors d'un
   * changement d'organisation, il lui faut donc son propre signal explicite. */
  activeOrganizationId: string | null;
  onOpenAcquisition?: () => void;
}

/**
 * Ticket F-062 — bouton « Marquer comme traité » (`POST /api/tasks/
 * {id}/complete/`, ticket 006, jusqu'ici jamais consommé par aucune app).
 * Visible uniquement pour une tâche `pending` — une tâche déjà `done`
 * reste affichée (cette vue n'a jamais filtré par statut, voir
 * `MyActionsView` ci-dessous), simplement sans bouton.
 */
function ActionItem({
  task, onCompleted, onOpenAcquisition,
}: { task: Task; onCompleted: () => void; onOpenAcquisition?: () => void }) {
  const api = useApiClient();
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    setCompleting(true);
    setError(null);
    try {
      await api.completeTask(task.id, task.organization);
      onCompleted();
    } catch {
      setError('Échec du marquage comme traité.');
      setCompleting(false);
    }
  }

  return (
    <li
      data-type={task.type}
      data-status={task.status}
      // Ticket F-055 (suite F-053/F-054) — même traitement que `Card` :
      // ombre + rayon plus prononcé, aucun autre repère visuel de
      // "carte" ici (même raisonnement que MissionsListView, CONTROL
      // PWA, ticket F-054).
      style={{
        padding: '12px',
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '6px',
      }}
    >
      <strong>{task.label}</strong>
      {task.status === 'pending' && (
        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {onOpenAcquisition && opensAcquisition(task) && task.type === 'task' && (
            <Button type="button" onClick={onOpenAcquisition}>Ouvrir mon acquisition</Button>
          )}
          <Button type="button" variant="secondary" onClick={() => { void handleComplete(); }} disabled={completing}>
            {completing ? 'Marquage…' : task.type === 'notification' ? 'Marquer comme lu' : 'Marquer comme traité'}
          </Button>
        </div>
      )}
      {error && <div style={{ marginTop: '8px' }}><AlertBanner title={error} /></div>}
    </li>
  );
}

export function MyActionsView({ activeOrganizationId, onOpenAcquisition }: MyActionsViewProps) {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyTasks(), [activeOrganizationId]);

  if (state.status === 'loading') {
    return <p>Chargement…</p>;
  }
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger vos actions." onRetry={state.refetch} />;
  }
  if (state.data.length === 0) {
    return <p>Aucune action en attente pour le moment.</p>;
  }

  // PO-2026-09-28-44 (P33) : ce qui attend d'abord ; ce qui est traité
  // ensuite, replié, pour ne pas s'accumuler sous les yeux du client.
  const pending = state.data.filter((task) => task.status === 'pending');
  const done = state.data.filter((task) => task.status !== 'pending');
  const list = (tasks: Task[]) => (
    <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {tasks.map((task) => (
        <ActionItem key={task.id} task={task} onCompleted={() => state.refetch()} onOpenAcquisition={onOpenAcquisition} />
      ))}
    </ul>
  );

  return (
    <section aria-label="Mes actions">
      {pending.length === 0 ? <p>Aucune action en attente pour le moment.</p> : list(pending)}
      {done.length > 0 && (
        <details style={{ marginTop: '16px' }}>
          <summary>{`Déjà traitées (${done.length})`}</summary>
          {list(done)}
        </details>
      )}
    </section>
  );
}
