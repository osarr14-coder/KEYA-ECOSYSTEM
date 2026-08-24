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
 * `status=pending` — la file ACTIONNABLE d'abord, jamais un tableau de
 * bord KPI au premier rendu (même doctrine que `ProgramRequestsView.tsx`,
 * ticket F-058).
 *
 * Ticket F-062 — bouton « Marquer comme traité ».
 *
 * Ticket F-063 (suite B-044) — `getAdminTasks`/`completeAdminTask`, PAS
 * `getMyTasks`/`completeTask` : `apps/web` est réservée à `admin_keyimmo`
 * (voir `hasAdminKeyimmoAccess`, `App.tsx`), dont deux types de tâches
 * (`devis_ajustement_refuse`/`lot_ledger_margin_negative`, tickets
 * 023/B-036) ont pour organisation celle du devis/grand-livre CIBLE,
 * jamais celle de KEIMMO — invisibles ET non complétables via l'ancien
 * endpoint mono-organisation. `getAdminTasks` boucle sur toutes les
 * organisations côté backend (bascule RLS) ; `completeAdminTask`
 * transmet `task.organization` pour la bascule ciblée.
 */
function TaskCard({ task, onCompleted }: { task: Task; onCompleted: () => void }) {
  const api = useApiClient();
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    setCompleting(true);
    setError(null);
    try {
      await api.completeAdminTask(task.id, task.organization);
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
  const state = useApiResource(() => api.getAdminTasks({ status: 'pending' }), []);

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
