import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { Task } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-061 — destination réelle de la cloche `AppShell` côté
 * `apps/web` (jusqu'ici un lien mort, `href="/tasks"`, ticket F-045).
 * `GET /api/me/tasks/` (ticket 006), déjà consommé pour le compteur
 * (`taskInboxCount`, ticket F-060), même filtre `status=pending` — la
 * file ACTIONNABLE d'abord, jamais un tableau de bord KPI au premier
 * rendu (même doctrine que `ProgramRequestsView.tsx`, ticket F-058).
 *
 * Ticket F-062 — bouton « Marquer comme traité » (`POST /api/tasks/
 * {id}/complete/`, ticket 006, jusqu'ici jamais consommé par aucune
 * app). Limite connue et NON résolue par ce ticket : `TaskViewSet` est
 * scopé à l'organisation ACTIVE de l'appelant (`OrganizationScopedMixin`)
 * — une tâche assignée à `admin_keyimmo` dont l'organisation est celle
 * d'un TIERS (`devis_ajustement_refuse`/`lot_ledger_margin_negative`,
 * `apps.tasks.services`, tickets 023/B-036 — organisation = celle du
 * devis/grand-livre, jamais KEIMMO) reste invisible ET non complétable
 * ici tant que l'organisation active d'admin_keyimmo ne correspond pas
 * — comportement PRÉEXISTANT à ce ticket (RLS `tasks_task`, mono-
 * organisation, aucune branche cross-org contrairement à `Litige`),
 * signalé à l'utilisateur, pas corrigé silencieusement.
 */
function TaskCard({ task, onCompleted }: { task: Task; onCompleted: () => void }) {
  const api = useApiClient();
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    setCompleting(true);
    setError(null);
    try {
      await api.completeTask(task.id);
      onCompleted();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.detail : undefined;
      setError(detail ?? 'Échec du marquage comme traité.');
      setCompleting(false);
    }
  }

  return (
    <li
      data-type={task.type}
      style={{
        padding: '12px',
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '14px',
        boxShadow: 'var(--keya-shadow-sm)',
      }}
    >
      <strong>{task.label}</strong>
      <div style={{ marginTop: '8px' }}>
        <Button type="button" variant="secondary" onClick={() => { void handleComplete(); }} disabled={completing}>
          {completing ? 'Marquage…' : 'Marquer comme traité'}
        </Button>
      </div>
      {error && <div style={{ marginTop: '8px' }}><AlertBanner title={error} /></div>}
    </li>
  );
}

export function TasksView() {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyTasks({ status: 'pending' }), []);

  return (
    <section aria-label="Tâches">
      <h2>Tâches</h2>

      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger vos tâches." onRetry={state.refetch} />
      )}
      {state.status === 'success' && state.data.length === 0 && (
        <p data-testid="no-tasks">Aucune tâche en attente pour le moment.</p>
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {state.data.map((task) => (
            <TaskCard key={task.id} task={task} onCompleted={() => state.refetch()} />
          ))}
        </ul>
      )}
    </section>
  );
}
