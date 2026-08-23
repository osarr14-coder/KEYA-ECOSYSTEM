import { ApiErrorBanner, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-061 — destination réelle de la cloche `AppShell` côté
 * `apps/build` (jusqu'ici un lien mort, `href="/tasks"`, ticket F-045).
 * Lecture seule, même principe que `apps/home/src/views/MyActionsView.tsx`
 * (ticket 008) : purement informatif, aucun bouton « traiter ». `GET
 * /api/me/tasks/` (ticket 006), déjà consommé pour le compteur
 * (`taskInboxCount`, ticket F-060), même filtre `status=pending` — la
 * file ACTIONNABLE d'abord, jamais un tableau de bord KPI au premier
 * rendu (même doctrine que la vue « Exceptions » de cette app, critère
 * produit 26.2).
 */
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
            <li
              key={task.id}
              data-type={task.type}
              style={{
                padding: '12px',
                border: `1px solid ${semanticColors.neutral.border}`,
                borderRadius: '14px',
                boxShadow: 'var(--keya-shadow-sm)',
              }}
            >
              <strong>{task.label}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
