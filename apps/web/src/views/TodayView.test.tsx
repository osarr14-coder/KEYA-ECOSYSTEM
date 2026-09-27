import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import type { AdminReservation } from '../api/types';
import { TodayView, taskTarget } from './TodayView';

const TASK = {
  id: 'task-1', organization: 'org-target', type: 'alert' as const, subject_type: 'procurement.devis', subject_id: 'devis-1',
  program: null, assignee: 'admin-1', source: 'devis_ajustement_refuse', label: 'Ajustement refusé sur le devis X',
  due_date: null, priority: 'high' as const, status: 'pending' as const,
  created_at: '2026-03-06T09:00:00Z', completed_at: null,
};

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getMyInboxTasks: async () => [],
    ...overrides,
  });
  const onNavigate = vi.fn();
  return {
    api,
    onNavigate,
    ...render(withApiClient(api, (
      <TodayView onNavigate={onNavigate} availableTabs={['reservations', 'payment-notices', 'devis']} showSales={false} showPaymentNotices={false} />
    ))),
  };
}

describe('TodayView — file des tâches (reprise de TasksView, tickets F-061/F-062/F-063)', () => {
  it('demande les tâches en attente (jamais toutes les tâches d\'un coup)', async () => {
    const getMyInboxTasks = vi.fn().mockResolvedValue([]);
    renderView({ getMyInboxTasks });

    await waitFor(() => expect(getMyInboxTasks).toHaveBeenCalledWith({ status: 'pending' }));
  });

  it('affiche un message quand aucune tâche n\'est en attente', async () => {
    renderView();
    expect(await screen.findByTestId('no-tasks')).toBeInTheDocument();
  });

  it('affiche les tâches en attente avec leur libellé', async () => {
    renderView({ getMyInboxTasks: async () => [TASK] });

    expect(await screen.findByText(TASK.label)).toBeInTheDocument();
  });

  it('affiche une erreur de chargement avec un bouton Réessayer', async () => {
    const getMyInboxTasks = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);
    renderView({ getMyInboxTasks });

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => expect(getMyInboxTasks).toHaveBeenCalledTimes(2));
  });

  it('marquer une tâche comme traitée appelle completeMyInboxTask puis recharge la liste', async () => {
    const completeMyInboxTask = vi.fn().mockResolvedValue({ ...TASK, status: 'done' });
    const getMyInboxTasks = vi.fn()
      .mockResolvedValueOnce([TASK])
      .mockResolvedValueOnce([]);
    renderView({ completeMyInboxTask, getMyInboxTasks });

    await screen.findByText(TASK.label);
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme traité' }));

    await waitFor(() => expect(completeMyInboxTask).toHaveBeenCalledWith(TASK.id, TASK.organization));
    await waitFor(() => expect(getMyInboxTasks).toHaveBeenCalledTimes(2));
  });

  it('un échec de marquage affiche une erreur locale', async () => {
    const completeMyInboxTask = vi.fn().mockRejectedValue(new Error('boom'));
    renderView({ completeMyInboxTask, getMyInboxTasks: async () => [TASK] });

    await screen.findByText(TASK.label);
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme traité' }));

    expect(await screen.findByText('Échec du marquage comme traité.')).toBeInTheDocument();
  });
});

function reservation(overrides: Partial<AdminReservation>): AdminReservation {
  return {
    id: 'r', status: 'held', status_label: 'Bloquée', held_until: '2026-09-28T14:30:00Z', price_amount: '30000000.00', currency: 'XOF',
    lot: { id: 'l', name: 'Lot A1', surface: null }, program: { id: 'p', name: 'Programme' }, organization: { id: 'o', name: 'Org' },
    client: { id: 'c', email: 'c@example.com', full_name: '' }, cancellation_reason: '', cancelled_by: null, validated_at: null,
    created_at: '2026-09-27T14:30:00Z', updated_at: '2026-09-27T14:30:00Z',
    ...overrides,
  };
}

describe('taskTarget — écran où traiter une tâche (ticket F-075)', () => {
  it('une réservation à valider ouvre directement son dossier', () => {
    expect(taskTarget({
      ...TASK, subject_type: 'sales.reservation', subject_id: 'res-9', source: 'reservation_to_validate:user-1',
    })).toEqual({ tab: 'reservations', reservationId: 'res-9' });
  });

  it('un virement à confirmer ouvre les virements déclarés, un ajustement refusé les devis', () => {
    expect(taskTarget({ ...TASK, subject_type: 'sales.paymentnotice', source: 'payment_notice_to_confirm:u' })).toEqual({ tab: 'payment-notices' });
    expect(taskTarget(TASK)).toEqual({ tab: 'devis' });
  });

  it('une source inconnue ne propose aucune navigation', () => {
    expect(taskTarget({ ...TASK, subject_type: 'x.y', source: 'inconnue' })).toBeNull();
  });
});

describe('TodayView — accès direct et chiffres (ticket F-075)', () => {
  it('« Ouvrir » navigue vers l\'écran de la tâche ; absent si cet écran n\'est pas accessible', async () => {
    const hidden = { ...TASK, id: 'task-2', label: 'Demande sur mesure', source: 'program_request_decided', subject_type: 'programs.programrequest' };
    const { onNavigate } = renderView({ getMyInboxTasks: async () => [TASK, hidden] });

    await screen.findByText(TASK.label);
    const buttons = screen.getAllByRole('button', { name: 'Ouvrir' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'devis' });
  });

  it('chiffres et pipeline dérivés des réservations et virements du serveur', async () => {
    const api = createMockApiClient({
      getMyInboxTasks: async () => [],
      listReservations: vi.fn().mockResolvedValue([
        reservation({ id: 'a' }),
        reservation({ id: 'b', validated_at: '2026-09-27T15:00:00Z' }),
        reservation({ id: 'c', status: 'reserved' }),
        reservation({ id: 'd', status: 'cancelled' }),
      ]),
      listPaymentNotices: vi.fn().mockResolvedValue([{ id: 'n' }]),
    });
    const onNavigate = vi.fn();
    render(withApiClient(api, (
      <TodayView onNavigate={onNavigate} availableTabs={['reservations', 'payment-notices']} showSales showPaymentNotices />
    )));

    await waitFor(() => expect(screen.getByTestId('kf-to-validate-value')).toHaveTextContent('1'));
    expect(screen.getByTestId('kf-notices-value')).toHaveTextContent('1');
    expect(screen.getByTestId('kf-active-value')).toHaveTextContent('3');
    expect(api.listPaymentNotices).toHaveBeenCalledWith('declared');
    const columns = screen.getAllByTestId('pipeline-column').map((column) => column.textContent);
    expect(columns).toEqual(['Bloquées2 dossiers', 'Réservées1 dossier', 'Concrétisées0 dossier', 'Expirées / annulées1 dossier']);

    fireEvent.click(screen.getByTestId('kf-to-validate'));
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'reservations' });
  });
});
