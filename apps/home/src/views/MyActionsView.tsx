import { useApiClient } from '../api/ApiClientContext';
import { useApiResource } from '../api/useApiResource';

export function MyActionsView() {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyTasks(), []);

  if (state.status === 'loading') {
    return <p>Chargement…</p>;
  }
  if (state.status === 'error') {
    return <p role="alert">Impossible de charger vos actions.</p>;
  }
  if (state.data.length === 0) {
    return <p>Aucune action en attente pour le moment.</p>;
  }

  return (
    <section aria-label="Mes actions">
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {state.data.map((task) => (
          <li key={task.id} data-type={task.type} data-status={task.status}>
            <strong>{task.label}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
