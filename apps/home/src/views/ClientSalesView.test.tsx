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
    expect(formatDateTime('2026-09-28T14:30:00Z')).toBe("28 septembre 2026 à 14:30 (heure d'Abidjan, GMT)");
  });
});

describe('ClientSalesView — catalogue et réservation (ticket F-066)', () => {
  it('affiche un lot publié avec son programme, sa localisation, sa surface et son prix', async () => {
    renderView();

    const item = await screen.findByTestId('catalog-lot');
    expect(item).toHaveTextContent('Résidence Démonstration Abidjan — Lot A12');
    expect(item).toHaveTextContent('Cocody');
    expect(item).toHaveTextContent('82.00 m²');
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
    expect(row).toHaveTextContent("jusqu'au 28 septembre 2026 à 14:30 (heure d'Abidjan, GMT)");
    expect(row).toHaveTextContent('Prochaine étape');
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
