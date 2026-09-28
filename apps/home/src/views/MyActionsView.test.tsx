import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

    render(withApiClient(api, <MyActionsView activeOrganizationId={null} />));

    expect(await screen.findByText(/Réserve ouverte sur le lot/)).toBeInTheDocument();
  });

  it("affiche un message explicite quand la liste est vide (aucune Task ne cible encore un client)", async () => {
    const api = createMockApiClient({ getMyTasks: async () => [] });

    render(withApiClient(api, <MyActionsView activeOrganizationId={null} />));

    expect(await screen.findByText(/aucune action en attente/i)).toBeInTheDocument();
  });

  it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement (ticket F-033)', async () => {
    const getMyTasks = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);
    const api = createMockApiClient({ getMyTasks });

    render(withApiClient(api, <MyActionsView activeOrganizationId={null} />));

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await screen.findByText(/aucune action en attente/i);
    expect(getMyTasks).toHaveBeenCalledTimes(2);
  });

  const PENDING_TASK = {
    id: 'task-1', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'x',
    program: null, assignee: 'client@example.com', source: 'reserve_opened',
    label: 'Réserve ouverte sur le lot « Lot 12 »',
    due_date: null, priority: 'normal' as const, status: 'pending' as const,
    created_at: '2026-03-05T09:00:00Z', completed_at: null,
  };

  it('une tâche en attente affiche le bouton "Marquer comme traité" (ticket F-062)', async () => {
    const api = createMockApiClient({ getMyTasks: async () => [PENDING_TASK] });

    render(withApiClient(api, <MyActionsView activeOrganizationId={null} />));

    expect(await screen.findByRole('button', { name: 'Marquer comme traité' })).toBeInTheDocument();
  });

  it('une tâche déjà traitée n\'affiche aucun bouton', async () => {
    const api = createMockApiClient({ getMyTasks: async () => [{ ...PENDING_TASK, status: 'done' as const }] });

    render(withApiClient(api, <MyActionsView activeOrganizationId={null} />));

    await screen.findByText(PENDING_TASK.label);
    expect(screen.queryByRole('button', { name: 'Marquer comme traité' })).not.toBeInTheDocument();
  });

  it('cliquer "Marquer comme traité" appelle completeTask puis recharge la liste', async () => {
    const completeTask = vi.fn().mockResolvedValue({ ...PENDING_TASK, status: 'done' });
    const getMyTasks = vi.fn()
      .mockResolvedValueOnce([PENDING_TASK])
      .mockResolvedValueOnce([{ ...PENDING_TASK, status: 'done' as const }]);
    const api = createMockApiClient({ completeTask, getMyTasks });

    render(withApiClient(api, <MyActionsView activeOrganizationId={null} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Marquer comme traité' }));

    await waitFor(() => expect(completeTask).toHaveBeenCalledWith(PENDING_TASK.id, undefined));
    await waitFor(() => expect(getMyTasks).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Marquer comme traité' })).not.toBeInTheDocument();
  });

  it('un échec de marquage affiche une erreur locale', async () => {
    const completeTask = vi.fn().mockRejectedValue(new Error('boom'));
    const api = createMockApiClient({ completeTask, getMyTasks: async () => [PENDING_TASK] });

    render(withApiClient(api, <MyActionsView activeOrganizationId={null} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Marquer comme traité' }));

    expect(await screen.findByText('Échec du marquage comme traité.')).toBeInTheDocument();
  });
});

describe('Lot 2 — mes actions reliées à l’action (PO-2026-09-28-44, P33)', () => {
  const base = {
    subject_type: 'sales.paymentcall', subject_id: 'x', program: null, assignee: 'c', due_date: null,
    priority: 'high' as const, created_at: '2026-09-28T09:00:00Z', completed_at: null,
  };

  it('en attente d’abord, ouverture de « Mon acquisition », traitées repliées', async () => {
    const onOpenAcquisition = vi.fn();
    const api = createMockApiClient({
      getMyTasks: async () => [
        { ...base, id: 't1', type: 'task' as const, source: 'payment_call_to_pay:u', label: 'Appel de fonds à régler', status: 'pending' as const },
        { ...base, id: 't2', type: 'notification' as const, source: 'reservation_ended:u', label: 'Réservation annulée le …', status: 'pending' as const },
        { ...base, id: 't3', type: 'task' as const, source: 'payment_call_to_pay:u', label: 'Frais réglés', status: 'done' as const },
      ],
    });

    render(withApiClient(api, <MyActionsView activeOrganizationId={null} onOpenAcquisition={onOpenAcquisition} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir mon acquisition' }));
    expect(onOpenAcquisition).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Marquer comme lu' })).toBeInTheDocument();
    expect(screen.getByText('Déjà traitées (1)')).toBeInTheDocument();
  });
});
