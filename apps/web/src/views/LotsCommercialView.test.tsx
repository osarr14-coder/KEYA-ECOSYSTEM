import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { CommercialLot, Lot } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { LotsCommercialView } from './LotsCommercialView';

const COMMERCIAL_LOT: CommercialLot = {
  id: 'lot-1',
  name: 'Lot A12',
  surface: '82.00',
  commercial_status: 'disponible',
  sale_price: '45000000.00',
  organization: { id: 'org-1', name: 'Promoteur Baobab SARL' },
  program: { id: 'program-1', name: 'Résidence Les Almadies' },
  asset: { id: 'asset-1', name: 'Bâtiment A' },
};

function lotResponse(overrides: Partial<Lot> = {}): Lot {
  return {
    id: COMMERCIAL_LOT.id,
    name: COMMERCIAL_LOT.name,
    asset: COMMERCIAL_LOT.asset.id,
    assigned_organization: null,
    surface: COMMERCIAL_LOT.surface,
    commercial_status: COMMERCIAL_LOT.commercial_status,
    sale_price: COMMERCIAL_LOT.sale_price,
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}, canEditPrice = true) {
  const api = createMockApiClient({
    searchLotsForCommercial: vi.fn().mockResolvedValue([COMMERCIAL_LOT]),
    ...overrides,
  });
  render(withApiClient(api, <LotsCommercialView canEditPrice={canEditPrice} />));
  return { api };
}

async function selectLot() {
  fireEvent.change(screen.getByLabelText('Rechercher un lot (nom)'), { target: { value: 'A12' } });
  fireEvent.click(await screen.findByRole('button', { name: /Lot A12/ }));
  await screen.findByRole('form', { name: 'Modifier le prix et le statut' });
}

describe('LotsCommercialView — prix et statut des lots (ticket F-064)', () => {
  it('affiche le contexte et l\'état commercial courant du lot sélectionné', async () => {
    renderView();
    await selectLot();

    expect(screen.getByText('Promoteur Baobab SARL')).toBeInTheDocument();
    expect(screen.getByText('Résidence Les Almadies')).toBeInTheDocument();
    expect(screen.getByText('82.00 m²')).toBeInTheDocument();
    expect(screen.getByLabelText('Statut commercial')).toHaveValue('disponible');
    expect(screen.getByLabelText('Prix de vente')).toHaveValue('45000000.00');
  });

  it('un changement de statut seul n\'envoie jamais le prix (réservé à admin_keyimmo, B-047)', async () => {
    const updateLotCommercial = vi.fn().mockResolvedValue(lotResponse({ commercial_status: 'reserve' }));
    renderView({ updateLotCommercial });
    await selectLot();

    fireEvent.change(screen.getByLabelText('Statut commercial'), { target: { value: 'reserve' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Modifications enregistrées.');
    expect(updateLotCommercial).toHaveBeenCalledWith('lot-1', 'org-1', { commercial_status: 'reserve' });
    expect(screen.getByText('Réservé', { selector: 'dd' })).toBeInTheDocument();
  });

  it('un nouveau prix est envoyé avec l\'organisation du lot et affiché après enregistrement', async () => {
    const updateLotCommercial = vi.fn().mockResolvedValue(lotResponse({ sale_price: '47500000.00' }));
    renderView({ updateLotCommercial });
    await selectLot();

    fireEvent.change(screen.getByLabelText('Prix de vente'), { target: { value: '47500000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByRole('status');
    expect(updateLotCommercial).toHaveBeenCalledWith('lot-1', 'org-1', { sale_price: '47500000.00' });
    expect(screen.getByText('47500000.00')).toBeInTheDocument();
  });

  it('rien de modifié : aucun appel API, message explicite', async () => {
    const updateLotCommercial = vi.fn();
    renderView({ updateLotCommercial });
    await selectLot();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Aucune modification à enregistrer.');
    expect(updateLotCommercial).not.toHaveBeenCalled();
  });

  it('affiche le refus du backend (ex. prix modifié par un rôle non admin)', async () => {
    const updateLotCommercial = vi.fn().mockRejectedValue(
      new ApiError(403, 'forbidden', 'Le prix de vente est réservé aux membres du rôle admin_keyimmo.'),
    );
    renderView({ updateLotCommercial });
    await selectLot();

    fireEvent.change(screen.getByLabelText('Prix de vente'), { target: { value: '1.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Le prix de vente est réservé');
    expect(screen.getByText('45000000.00')).toBeInTheDocument();
  });

  it('ticket F-065 — sans droit sur le prix (ADV) : champ désactivé, seul le statut part', async () => {
    const updateLotCommercial = vi.fn().mockResolvedValue(lotResponse({ commercial_status: 'vendu' }));
    renderView({ updateLotCommercial }, false);
    await selectLot();

    expect(screen.getByLabelText('Prix de vente')).toBeDisabled();
    expect(screen.getByText(/réservé à l'admin KEYIMMO/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Statut commercial'), { target: { value: 'vendu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByRole('status');
    expect(updateLotCommercial).toHaveBeenCalledWith('lot-1', 'org-1', { commercial_status: 'vendu' });
  });
});
