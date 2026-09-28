import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { PublicHome } from './PublicHome';
import { PublicLayout } from './PublicLayout';

/** PO-2026-09-28-26 : façade à l'ouverture, plan du lot A1 sur la carte du
 * programme fictif, schéma des rôles ; mentions « programme fictif ». */
function renderWithOffer() {
  const api = createMockApiClient({
    getPublicOffer: vi.fn(() => Promise.resolve([{
      id: 'p1', name: 'Résidence Démonstration Abidjan', constructeur: 'Constructeur Démonstration Abidjan', locations: ['Cocody'],
      currency: 'XOF', total_lots: 2, available_lots: 1, price_from: '30000000.00',
      lots: [{ id: 'lot-2', name: 'Lot A2', asset: 'Bâtiment A', surface: '75.00', price: '30000000.00' }],
      payment_schedule: { reservation_fee: '100000', steps: [] },
    }])),
    getPublicWorksites: vi.fn(() => Promise.resolve([])),
  });
  return render(withApiClient(api, (
    <PublicLayout path="/" navigate={vi.fn()}>
      <PublicHome navigate={vi.fn()} />
    </PublicLayout>
  )));
}

describe('Page publique — illustrations (PO-2026-09-28-26)', () => {
  it('la façade ouvre la page, avant les programmes, avec la mention « programme fictif »', async () => {
    renderWithOffer();
    const facade = screen.getByTestId('facade-illustration');
    const programmes = document.getElementById('programmes')!;
    expect(facade.compareDocumentPosition(programmes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(facade).toHaveTextContent(/programme fictif/);
  });

  it('le plan du lot A1 est sur la carte du programme (même si seul A2 est disponible) ; le schéma des rôles est présent', async () => {
    renderWithOffer();
    const card = await screen.findByTestId('public-program');
    expect(within(card).getByTestId('lot-plan-a1')).toHaveTextContent('programme fictif');
    expect(within(card).getAllByTestId('lot-plan-a1')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Trois rôles distincts', level: 2 })).toBeInTheDocument();
  });
});
