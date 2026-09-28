import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { CatalogLot, Reservation } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { ClientSalesView, formatAmount, formatDateTime } from './ClientSalesView';

const LOT: CatalogLot = {
  id: 'lot-1',
  name: 'Lot A12',
  surface: '82.00',
  sale_price: '30000000.00',
  currency: 'XOF',
  organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
  program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
  asset: { id: 'asset-1', name: 'Bâtiment A', location: 'Cocody' },
};

function reservation(overrides: Partial<Reservation> = {}): Reservation {
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
    cancellation_reason: '',
    created_at: '2026-09-27T14:30:00Z',
    updated_at: '2026-09-27T14:30:00Z',
    ...overrides,
  };
}

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getMyReservations: vi.fn().mockResolvedValue([]),
    getCatalogLots: vi.fn().mockResolvedValue([LOT]),
    getMyContracts: vi.fn().mockResolvedValue([]),
    getMyPaymentCalls: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
  render(withApiClient(api, <ClientSalesView />));
  return { api };
}

describe('formatage (ticket F-066)', () => {
  it('montant entier en XOF, séparateurs français, jamais de décimales', () => {
    expect(formatAmount('30000000.00', 'XOF').replace(/\s/g, ' ')).toBe('30 000 000 XOF');
  });

  it('date avec son fuseau explicite (CDC §5)', () => {
    expect(formatDateTime('2026-09-28T14:30:00Z')).toBe('28 sept. 2026, 14:30 (GMT, Abidjan)'); // Audit UI R1 (F06)
  });
});

describe('ClientSalesView — catalogue et réservation (ticket F-066)', () => {
  it('affiche un lot publié avec son programme, sa localisation, sa surface et son prix', async () => {
    renderView();

    const item = await screen.findByTestId('catalog-lot');
    expect(item).toHaveTextContent('Résidence Démonstration Abidjan — Lot A12');
    expect(item).toHaveTextContent('Cocody');
    // Adapté selon PO-2026-09-27-20 (DESIGN_SYSTEM §9, X01) : surface sans décimales inutiles.
    expect(item).toHaveTextContent('82 m²');
    expect(item).not.toHaveTextContent('82.00');
    expect(item.textContent!.replace(/\s/g, ' ')).toContain('30 000 000 XOF');
    expect(screen.getByText("Vous n'avez encore réservé aucun bien.")).toBeInTheDocument();
  });

  it('réserver envoie le lot ET l\'organisation du programme, puis rafraîchit les deux listes', async () => {
    const requestReservation = vi.fn().mockResolvedValue(reservation());
    const getMyReservations = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([reservation()]);
    const getCatalogLots = vi.fn().mockResolvedValueOnce([LOT]).mockResolvedValue([]);
    renderView({ requestReservation, getMyReservations, getCatalogLots });

    fireEvent.click(await screen.findByRole('button', { name: 'Réserver ce bien' }));

    await waitFor(() => expect(requestReservation).toHaveBeenCalledWith('lot-1', 'org-promoteur'));
    expect(await screen.findByTestId('reservation-status')).toHaveTextContent('Bloquée');
    expect(await screen.findByText("Aucun bien n'est disponible à la réservation pour le moment.")).toBeInTheDocument();
  });

  it('un refus du serveur (lot bloqué par un autre client, T01) est affiché tel quel', async () => {
    const requestReservation = vi.fn().mockRejectedValue(
      new ApiError(409, 'conflict', { detail: "Ce lot n'est plus disponible à la réservation." }),
    );
    renderView({ requestReservation });

    fireEvent.click(await screen.findByRole('button', { name: 'Réserver ce bien' }));

    expect(await screen.findByText("Ce lot n'est plus disponible à la réservation.")).toBeInTheDocument();
  });

  it('une réservation bloquée montre son échéance et la prochaine étape', async () => {
    renderView({ getMyReservations: vi.fn().mockResolvedValue([reservation()]) });

    const row = await screen.findByTestId('reservation');
    expect(row).toHaveTextContent("jusqu'au 28 sept. 2026, 14:30 (GMT, Abidjan)");
    // Ticket F-071 — tant que l'ADV n'a pas validé, le client sait qu'il attend.
    expect(row).toHaveTextContent('Votre conseiller examine votre dossier'); // Audit UI R1 (J07)
  });

  it('ticket F-071 — une réservation validée invite à régler les frais puis à déclarer le virement', async () => {
    renderView({
      getMyReservations: vi.fn().mockResolvedValue([reservation({ validated_at: '2026-09-27T15:00:00Z' })]),
    });

    const row = await screen.findByTestId('reservation');
    expect(row).toHaveTextContent('Réglez les frais de réservation, puis signalez votre virement'); // J07, PO-05
  });

  it('une réservation expirée explique la libération du bien, sans bouton d\'annulation', async () => {
    renderView({
      getMyReservations: vi.fn().mockResolvedValue([reservation({ status: 'expired', status_label: 'Expirée' })]),
    });

    const row = await screen.findByTestId('reservation');
    expect(row).toHaveTextContent('le bien a été libéré');
    expect(screen.queryByRole('button', { name: 'Annuler cette réservation' })).not.toBeInTheDocument();
  });

  it('l\'annulation demande une confirmation explicite avant l\'appel', async () => {
    const cancelMyReservation = vi.fn().mockResolvedValue(reservation({ status: 'cancelled' }));
    renderView({ getMyReservations: vi.fn().mockResolvedValue([reservation()]), cancelMyReservation });

    fireEvent.click(await screen.findByRole('button', { name: 'Annuler cette réservation' }));
    expect(cancelMyReservation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));

    await waitFor(() => expect(cancelMyReservation).toHaveBeenCalledWith('reservation-1'));
  });
});

describe('Lot 1 — cohérence de l’espace client (PO-2026-09-28-43)', () => {
  it('P28 — une annulation par le gestionnaire est affichée en tête, datée, attribuée et motivée', async () => {
    renderView({
      getMyReservations: vi.fn().mockResolvedValue([reservation({
        status: 'cancelled', status_label: 'Annulée', cancellation_reason: 'Dossier incomplet (motif fictif)',
        ended_at: '2026-09-28T16:05:00Z',
        ended_by: { kind: 'team', label: 'KEYIMMO AFRIC démo · Gestionnaire' },
      })]),
    });

    const notice = await screen.findByTestId('reservation-ended');
    expect(notice).toHaveTextContent('Votre réservation a été annulée — Résidence Démonstration Abidjan / Lot A12');
    expect(notice).toHaveTextContent(
      'Réservation annulée le 28 sept. 2026, 16:05 (GMT, Abidjan) par KEYIMMO AFRIC démo · Gestionnaire '
      + '— motif : Dossier incomplet (motif fictif) : le bien a été libéré.',
    );
  });

  it('P28 — une annulation à la demande du client le dit, sans nommer personne', async () => {
    renderView({
      getMyReservations: vi.fn().mockResolvedValue([reservation({
        status: 'cancelled', status_label: 'Annulée', ended_at: '2026-09-28T16:05:00Z', ended_by: { kind: 'client', label: null },
      })]),
    });

    expect(await screen.findByTestId('reservation-ended')).toHaveTextContent('à votre demande');
  });

  it('T02 — une expiration est affichée en tête avec son échéance et la possibilité de refaire une demande', async () => {
    renderView({
      getMyReservations: vi.fn().mockResolvedValue([reservation({
        status: 'expired', status_label: 'Expirée', ended_at: '2026-09-28T14:31:00Z', ended_by: { kind: 'expired', label: null },
      })]),
    });

    const notice = await screen.findByTestId('reservation-ended');
    expect(notice).toHaveTextContent('Votre blocage a expiré');
    expect(notice).toHaveTextContent('avant l’échéance du 28 sept. 2026, 14:30 (GMT, Abidjan)');
    expect(notice).toHaveTextContent('vous pouvez refaire une demande');
    expect(await screen.findByRole('button', { name: 'Réserver ce bien' })).toBeEnabled();
  });

  it('aucun avis de fin quand la réservation la plus récente est active', async () => {
    renderView({
      getMyReservations: vi.fn().mockResolvedValue([
        reservation({ id: 'reservation-2' }),
        reservation({ status: 'cancelled', status_label: 'Annulée', ended_at: '2026-09-27T10:00:00Z' }),
      ]),
    });

    await screen.findAllByTestId('reservation');
    expect(screen.queryByTestId('reservation-ended')).not.toBeInTheDocument();
  });

  it('P29 — après un refus (T01), le catalogue se recharge et le motif reste affiché', async () => {
    const requestReservation = vi.fn().mockRejectedValue(
      new ApiError(409, 'conflict', { detail: "Ce lot n'est plus disponible à la réservation." }),
    );
    const getCatalogLots = vi.fn().mockResolvedValueOnce([LOT]).mockResolvedValue([]);
    renderView({ requestReservation, getCatalogLots });

    fireEvent.click(await screen.findByRole('button', { name: 'Réserver ce bien' }));

    expect(await screen.findByText("Ce lot n'est plus disponible à la réservation.")).toBeInTheDocument();
    expect(await screen.findByText("Aucun bien n'est disponible à la réservation pour le moment.")).toBeInTheDocument();
    expect(screen.getByText('Bien demandé : Résidence Démonstration Abidjan — Lot A12.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réserver ce bien' })).not.toBeInTheDocument();
  });
});
