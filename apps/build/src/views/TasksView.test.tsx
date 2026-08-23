import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { TasksView } from './TasksView';

const TASK = {
  id: 'task-1', type: 'task' as const, subject_type: 'inspections.reserve', subject_id: 'res-1',
  program: null, assignee: 'constructeur-1', source: 'reserve_opened', label: 'Réserve ouverte sur le lot A12',
  due_date: null, priority: 'normal' as const, status: 'pending' as const,
  created_at: '2026-03-06T09:00:00Z', completed_at: null,
};

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getMyTasks: async () => [],
    ...overrides,
  });
  return { api, ...render(withApiClient(api, <TasksView />)) };
}

describe('TasksView', () => {
  it('demande les tâches en attente (jamais toutes les tâches d\'un coup)', async () => {
    const getMyTasks = vi.fn().mockResolvedValue([]);
    renderView({ getMyTasks });

    await waitFor(() => expect(getMyTasks).toHaveBeenCalledWith({ status: 'pending' }));
  });

  it('affiche un message quand aucune tâche n\'est en attente', async () => {
    renderView();
    expect(await screen.findByTestId('no-tasks')).toBeInTheDocument();
  });

  it('affiche les tâches en attente avec leur libellé', async () => {
    renderView({ getMyTasks: async () => [TASK] });

    expect(await screen.findByText(TASK.label)).toBeInTheDocument();
  });

  it('affiche une erreur de chargement avec un bouton Réessayer', async () => {
    const getMyTasks = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);
    renderView({ getMyTasks });

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => expect(getMyTasks).toHaveBeenCalledTimes(2));
  });
});
