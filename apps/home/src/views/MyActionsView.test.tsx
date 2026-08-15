import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { MyActionsView } from './MyActionsView';

describe('MyActionsView', () => {
  it("affiche les tâches telles que renvoyées par GET /me/tasks (ticket 006), sans les filtrer localement", async () => {
    const api = createMockApiClient({
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'task', subject_type: 'inbox_tasks.task', subject_id: 'x',
          program: null, assignee: 'client@example.com', source: 'reserve_opened',
          label: 'Réserve ouverte sur le lot « Lot 12 » — correction attendue du constructeur',
          due_date: null, priority: 'normal', status: 'pending',
          created_at: '2026-03-05T09:00:00Z', completed_at: null,
        },
      ],
    });

    render(withApiClient(api, <MyActionsView />));

    expect(await screen.findByText(/Réserve ouverte sur le lot/)).toBeInTheDocument();
  });

  it("affiche un message explicite quand la liste est vide (aucune Task ne cible encore un client)", async () => {
    const api = createMockApiClient({ getMyTasks: async () => [] });

    render(withApiClient(api, <MyActionsView />));

    expect(await screen.findByText(/aucune action en attente/i)).toBeInTheDocument();
  });
});
