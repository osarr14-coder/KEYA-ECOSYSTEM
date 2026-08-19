import { useApiClient } from '../api/ApiClientContext';
import { useApiResource } from '../api/useApiResource';

export interface MyActionsViewProps {
  /** Ticket 019 — dans les deps de `useApiResource` ci-dessous : cette vue
   * n'a pas de `lotId` pour déclencher un refetch naturellement lors d'un
   * changement d'organisation, il lui faut donc son propre signal explicite. */
  activeOrganizationId: string | null;
}

export function MyActionsView({ activeOrganizationId }: MyActionsViewProps) {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyTasks(), [activeOrganizationId]);

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
