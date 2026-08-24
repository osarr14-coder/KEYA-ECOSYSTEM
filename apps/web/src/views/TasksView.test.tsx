import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { TasksView } from './TasksView';

const TASK = {
  id: 'task-1', organization: 'org-target', type: 'alert' as const, subject_type: 'procurement.devis', subject_id: 'devis-1',
  program: null, assignee: 'admin-1', source: 'devis_ajustement_refuse', label: 'Ajustement refusé sur le devis X',
  due_date: null, priority: 'high' as const, status: 'pending' as const,
  created_at: '2026-03-06T09:00:00Z', completed_at: null,
};

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getAdminTasks: async () => [],
    ...overrides,
  });
  return { api, ...render(withApiClient(api, <TasksView />)) };
}

describe('TasksView', () => {
  it('demande les tâches en attente (jamais toutes les tâches d\'un coup)', async () => {
    const getAdminTasks = vi.fn().mockResolvedValue([]);
    renderView({ getAdminTasks });

    await waitFor(() => expect(getAdminTasks).toHaveBeenCalledWith({ status: 'pending' }));
  });

  it('affiche un message quand aucune tâche n\'est en attente', async () => {
    renderView();
    expect(await screen.findByTestId('no-tasks')).toBeInTheDocument();
  });

  it('affiche les tâches en attente avec leur libellé', async () => {
    renderView({ getAdminTasks: async () => [TASK] });

    expect(await screen.findByText(TASK.label)).toBeInTheDocument();
  });

  it('affiche une erreur de chargement avec un bouton Réessayer', async () => {
    const getAdminTasks = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);
    renderView({ getAdminTasks });

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => expect(getAdminTasks).toHaveBeenCalledTimes(2));
  });

  it('marquer une tâche comme traitée appelle completeAdminTask puis recharge la liste', async () => {
    const completeAdminTask = vi.fn().mockResolvedValue({ ...TASK, status: 'done' });
    const getAdminTasks = vi.fn()
      .mockResolvedValueOnce([TASK])
      .mockResolvedValueOnce([]);
    renderView({ completeAdminTask, getAdminTasks });

    await screen.findByText(TASK.label);
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme traité' }));

    await waitFor(() => expect(completeAdminTask).toHaveBeenCalledWith(TASK.id, TASK.organization));
    await waitFor(() => expect(getAdminTasks).toHaveBeenCalledTimes(2));
  });

  it('un échec de marquage affiche une erreur locale', async () => {
    const completeAdminTask = vi.fn().mockRejectedValue(new Error('boom'));
    renderView({ completeAdminTask, getAdminTasks: async () => [TASK] });

    await screen.findByText(TASK.label);
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme traité' }));

    expect(await screen.findByText('Échec du marquage comme traité.')).toBeInTheDocument();
  });
});
