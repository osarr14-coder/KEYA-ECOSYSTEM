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

/** Ticket F-075 — la liste mène à la fiche dossier. */
async function openDossier() {
  fireEvent.click(await screen.findByRole('button', { name: /Ouvrir le dossier/ }));
}

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}, openReservationId: string | null = null) {
  const api = createMockApiClient({
    listReservations: vi.fn().mockResolvedValue([reservation()]),
    listContracts: vi.fn().mockResolvedValue([]),
    getFinanceFile: vi.fn().mockResolvedValue({
      reservation: { id: 'reservation-1', status: 'held', status_label: 'Bloquée' }, calls: [], receipts: [],
    }),
    getTeamPaymentCalls: vi.fn().mockResolvedValue({ calls: [], candidates: [], blocking_reason: null }),
    ...overrides,
  });
  render(withApiClient(api, <ReservationsView openReservationId={openReservationId} />));
  return { api };
}

describe('ReservationsView — réservations côté équipe KEYIMMO (ticket F-067)', () => {
  it('liste par défaut les réservations bloquées ; la fiche montre client, prix figé et échéance datée', async () => {
    const { api } = renderView();

    const row = await screen.findByTestId('reservation-row');
    expect(api.listReservations).toHaveBeenCalledWith('held');
    expect(row).toHaveTextContent('Awa Koné');
    expect(row).toHaveTextContent('Lot A12');
    expect(row).toHaveTextContent('À examiner'); // Audit UI R1 (J07)

    await openDossier();
    expect(screen.getByRole('heading', { name: 'Awa Koné · Lot A12' })).toBeInTheDocument();
    const dossier = screen.getByRole('article', { name: 'Dossier — Awa Koné, Lot A12' });
    expect(dossier).toHaveTextContent('acquereur@example.com');
    expect(dossier.textContent!.replace(/\s/g, ' ')).toContain('30 000 000 XOF');
    expect(dossier).toHaveTextContent('28 sept. 2026, 14:30 (GMT, Abidjan)'); // Audit UI R1 (F06)
  });

  it('ticket F-075 — la recherche filtre la liste (client, lot, programme) ; « Dossiers clients » revient à la liste', async () => {
    renderView({
      listReservations: vi.fn().mockResolvedValue([
        reservation(),
        reservation({ id: 'reservation-2', client: { id: 'c2', email: 'yao@example.com', full_name: 'Yao Kouassi' }, lot: { id: 'l2', name: 'Lot B3', surface: null } }),
      ]),
    });
    expect(await screen.findAllByTestId('reservation-row')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Rechercher un dossier'), { target: { value: 'yao' } });
    expect(screen.getAllByTestId('reservation-row')).toHaveLength(1);
    expect(screen.getByTestId('reservation-row')).toHaveTextContent('Yao Kouassi');

    await openDossier();
    fireEvent.click(screen.getByRole('button', { name: 'Dossiers clients' }));
    expect(screen.getByTestId('reservation-row')).toBeInTheDocument();
  });

  it('ticket F-075 — ouvert depuis « À faire » : dossier affiché directement, tous statuts confondus', async () => {
    const { api } = renderView({}, 'reservation-1');
    expect(await screen.findByRole('article', { name: 'Dossier — Awa Koné, Lot A12' })).toBeInTheDocument();
    expect(api.listReservations).toHaveBeenCalledWith(undefined);
  });

  it('changer le filtre relance la liste avec le statut choisi, « Toutes » sans filtre', async () => {
    const { api } = renderView();
    await screen.findByTestId('reservation-row');

    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'expired' } });
    await waitFor(() => expect(api.listReservations).toHaveBeenLastCalledWith('expired'));
    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: '' } });
    await waitFor(() => expect(api.listReservations).toHaveBeenLastCalledWith(undefined));
  });

  it('l\'annulation exige un motif, l\'envoie avec l\'organisation du lot, puis rafraîchit', async () => {
    const cancelReservation = vi.fn().mockResolvedValue(reservation({ status: 'cancelled' }));
    const listReservations = vi.fn().mockResolvedValueOnce([reservation()]).mockResolvedValue([]);
    renderView({ cancelReservation, listReservations });
    await openDossier();

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
    await openDossier();

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
    await openDossier();

    expect(await screen.findByText('adv@example.com')).toBeInTheDocument();
    expect(screen.getByText('Doublon')).toBeInTheDocument();
    expect(screen.queryByLabelText("Motif d'annulation")).not.toBeInTheDocument();
  });

  it('ticket F-071 — l’ADV valide la réservation (appel des frais émis), puis la liste se rafraîchit', async () => {
    const validateReservation = vi.fn().mockResolvedValue(reservation({ validated_at: '2026-09-27T15:00:00Z' }));
    const listReservations = vi.fn()
      .mockResolvedValueOnce([reservation()])
      .mockResolvedValue([reservation({ validated_at: '2026-09-27T15:00:00Z', validated_by: 'adv.demo@keya.test' })]);
    renderView({ validateReservation, listReservations });
    await openDossier();

    expect(await screen.findByTestId('reservation-validation')).toHaveTextContent('Examen en attente'); // Audit UI R1 (J07)
    fireEvent.click(screen.getByRole('button', { name: 'Dossier examiné : appeler les frais de réservation' }));

    await waitFor(() => expect(validateReservation).toHaveBeenCalledWith('reservation-1', 'org-promoteur'));
    await waitFor(() => expect(screen.getByTestId('reservation-validation')).toHaveTextContent('Examiné par adv.demo@keya.test'));
    expect(screen.queryByRole('button', { name: 'Dossier examiné : appeler les frais de réservation' })).not.toBeInTheDocument();
  });
});

describe('ReservationsView — vue Finance en lecture seule (audit UI R1, R03, PO-2026-09-27-10)', () => {
  // Adapté selon PO-2026-09-28-12 (libellé « Appels par dossier »).
  it('« Appels par dossier » : aucune gestion du dossier, aucun contrat, aucun formulaire d’encaissement', async () => {
    const listContracts = vi.fn().mockResolvedValue([]);
    const api = createMockApiClient({
      listReservations: vi.fn().mockResolvedValue([reservation()]),
      listContracts,
      getFinanceFile: vi.fn().mockResolvedValue({
        reservation: { id: 'reservation-1', status: 'held', status_label: 'Bloquée' }, calls: [], receipts: [],
      }),
      getTeamPaymentCalls: vi.fn().mockResolvedValue({ calls: [], candidates: [], blocking_reason: null }),
    });
    render(withApiClient(api, (
      <ReservationsView mode="finance" openReservationId="reservation-1" permissions={{ canManageSales: false, canRecordMovements: false }} />
    )));

    expect(await screen.findByRole('button', { name: /Appels par dossier/ })).toBeInTheDocument();
    await waitFor(() => expect(api.getFinanceFile).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Dossier examiné : appeler les frais de réservation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Prochaine action' })).not.toBeInTheDocument();
    expect(screen.queryByText('Contrat')).not.toBeInTheDocument();
    expect(listContracts).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Enregistrer/ })).not.toBeInTheDocument();
  });
});
