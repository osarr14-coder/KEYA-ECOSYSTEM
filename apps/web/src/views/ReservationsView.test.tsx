import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { AdminReservation } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { ReservationsView } from './ReservationsView';

function reservation(overrides: Partial<AdminReservation> = {}): AdminReservation {
  return {
    id: 'reservation-1',
    status: 'held',
    status_label: 'Bloquée',
    held_until: '2026-09-28T14:30:00Z',
    price_amount: '30000000.00',
    currency: 'XOF',
    lot: { id: 'lot-1', name: 'Lot A12', surface: '82.00' },
    program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
    organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
    client: { id: 'client-1', email: 'acquereur@example.com', full_name: 'Awa Koné' },
    cancellation_reason: '',
    cancelled_by: null,
    created_at: '2026-09-27T14:30:00Z',
    updated_at: '2026-09-27T14:30:00Z',
    ...overrides,
  };
}

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    listReservations: vi.fn().mockResolvedValue([reservation()]),
    listContracts: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
  render(withApiClient(api, <ReservationsView />));
  return { api };
}

describe('ReservationsView — réservations côté équipe KEYIMMO (ticket F-067)', () => {
  it('liste par défaut les réservations bloquées, avec client, prix figé et échéance datée', async () => {
    const { api } = renderView();

    expect(await screen.findByRole('heading', { name: 'Résidence Démonstration Abidjan — Lot A12' })).toBeInTheDocument();
    expect(api.listReservations).toHaveBeenCalledWith('held');
    expect(screen.getByText('Awa Koné (acquereur@example.com)')).toBeInTheDocument();
    expect(screen.getByText(/30\s000\s000 XOF/)).toBeInTheDocument();
    expect(screen.getByText("28 septembre 2026 à 14:30 (heure d'Abidjan, GMT)")).toBeInTheDocument();
  });

  it('changer le filtre relance la liste avec le statut choisi, « Toutes » sans filtre', async () => {
    const { api } = renderView();
    await screen.findByTestId('reservation-status');

    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'expired' } });
    await waitFor(() => expect(api.listReservations).toHaveBeenLastCalledWith('expired'));
    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: '' } });
    await waitFor(() => expect(api.listReservations).toHaveBeenLastCalledWith(undefined));
  });

  it('l\'annulation exige un motif, l\'envoie avec l\'organisation du lot, puis rafraîchit', async () => {
    const cancelReservation = vi.fn().mockResolvedValue(reservation({ status: 'cancelled' }));
    const listReservations = vi.fn().mockResolvedValueOnce([reservation()]).mockResolvedValue([]);
    renderView({ cancelReservation, listReservations });

    const button = await screen.findByRole('button', { name: 'Annuler la réservation' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motif d'annulation"), { target: { value: 'Dossier incomplet' } });
    fireEvent.click(button);

    await waitFor(() => expect(cancelReservation).toHaveBeenCalledWith('reservation-1', 'org-promoteur', 'Dossier incomplet'));
    expect(await screen.findByText('Aucune réservation dans cet état.')).toBeInTheDocument();
  });

  it('un refus du serveur (blocage déjà expiré) est affiché tel quel', async () => {
    const cancelReservation = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'Ce blocage a déjà expiré.'));
    renderView({ cancelReservation });

    fireEvent.change(await screen.findByLabelText("Motif d'annulation"), { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la réservation' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ce blocage a déjà expiré.');
  });

  it('une réservation annulée affiche son auteur et son motif, sans formulaire', async () => {
    renderView({
      listReservations: vi.fn().mockResolvedValue([reservation({
        status: 'cancelled', status_label: 'Annulée', cancelled_by: 'adv@example.com', cancellation_reason: 'Doublon',
      })]),
    });

    expect(await screen.findByText('adv@example.com')).toBeInTheDocument();
    expect(screen.getByText('Doublon')).toBeInTheDocument();
    expect(screen.queryByLabelText("Motif d'annulation")).not.toBeInTheDocument();
  });
});
