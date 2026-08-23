import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { Task } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-061 — destination réelle de la cloche `AppShell` côté
 * `apps/build` (jusqu'ici un lien mort, `href="/tasks"`, ticket F-045).
 * `GET /api/me/tasks/` (ticket 006), déjà consommé pour le compteur
 * (`taskInboxCount`, ticket F-060), même filtre `status=pending` — la
 * file ACTIONNABLE d'abord, jamais un tableau de bord KPI au premier
 * rendu (même doctrine que la vue « Exceptions » de cette app, critère
 * produit 26.2).
 *
 * Ticket F-062 — bouton « Marquer comme traité » (`POST /api/tasks/
 * {id}/complete/`, ticket 006, jusqu'ici jamais consommé par aucune
 * app). Fonctionne pour ces tâches : `reserve_opened` a pour
 * organisation celle du constructeur assigné, qui correspond à
 * l'organisation active courante (contrairement au cas admin_keyimmo
 * cross-org documenté côté `apps/web/src/views/TasksView.tsx`).
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
    } catch {
      setError('Échec du marquage comme traité.');
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
