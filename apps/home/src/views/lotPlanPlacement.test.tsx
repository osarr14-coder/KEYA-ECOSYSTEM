import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogLot } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { ClientSalesView } from './ClientSalesView';

/** PO-2026-09-28-26 : plan du lot A1 sur la vignette du catalogue (plein
 * écran, zoom tactile) ; aucun plan pour le lot A2. */
function lot(name: string, id: string): CatalogLot {
  return {
    id, name, surface: '82.00', sale_price: '30000000.00', currency: 'XOF',
    organization: { id: 'org', name: 'Constructeur Démonstration Abidjan' },
    program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
    asset: { id: 'asset-1', name: 'Bâtiment A', location: 'Cocody' },
  };
}

describe('Catalogue client — plan du lot (PO-2026-09-28-26)', () => {
  it('la vignette du lot A1 porte son plan, celle du lot A2 n’en affiche aucun', async () => {
    const api = createMockApiClient({
      getMyReservations: vi.fn().mockResolvedValue([]),
      getCatalogLots: vi.fn().mockResolvedValue([lot('Lot A1', 'a1'), lot('Lot A2', 'a2')]),
    });
    render(withApiClient(api, <ClientSalesView />));

    const cards = await screen.findAllByTestId('catalog-lot');
    const a1 = cards.find((card) => card.textContent?.includes('Lot A1'))!;
    const a2 = cards.find((card) => card.textContent?.includes('Lot A2'))!;
    expect(within(a1).getByTestId('lot-plan-a1')).toHaveTextContent('programme fictif');
    expect(within(a2).queryByTestId('lot-plan-a1')).not.toBeInTheDocument();
    expect(a2.querySelector('svg')).toBeNull();

    fireEvent.click(within(a1).getByRole('button', { name: 'Agrandir le plan du lot A1 (programme fictif)' }));
    expect(screen.getByTestId('plan-viewer')).toBeInTheDocument();
  });
});
