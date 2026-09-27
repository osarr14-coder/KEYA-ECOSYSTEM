import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ClientPaymentCall } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { ClientPaymentCallsPanel } from './ClientPaymentCallsPanel';

function call(overrides: Partial<ClientPaymentCall> = {}): ClientPaymentCall {
  return {
    id: 'call-1',
    kind: 'frais',
    kind_label: 'Frais de réservation',
    tier_label: '',
    amount: '100000.00',
    currency: 'XOF',
    issued_at: '2026-09-27T15:00:00Z',
    settled_amount: '100000.00',
    settlement: 'settled',
    ...overrides,
  };
}

describe('ClientPaymentCallsPanel — appels de fonds du client (ticket F-068)', () => {
  it('affiche chaque appel avec son état de couverture calculé par le serveur', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([
        call(),
        call({
          id: 'call-2', kind: 'premier_versement', kind_label: 'Premier versement', amount: '2900000.00',
          settled_amount: '1000000.00', settlement: 'partial',
        }),
      ]),
    });
    render(withApiClient(api, <ClientPaymentCallsPanel reservationId="reservation-1" />));

    const rows = await screen.findAllByTestId('payment-call');
    expect(api.getMyPaymentCalls).toHaveBeenCalledWith('reservation-1');
    expect(rows[0]).toHaveTextContent(/Frais de réservation : 100\s000 XOF · Couvert/);
    expect(rows[1]).toHaveTextContent(/Premier versement : 2\s900\s000 XOF · Partiellement couvert \(1\s000\s000 XOF reçus\)/);
  });

  it("n'affiche rien tant qu'aucun appel n'est émis", async () => {
    const getMyPaymentCalls = vi.fn().mockResolvedValue([]);
    const api = createMockApiClient({ getMyPaymentCalls });
    const { container } = render(withApiClient(api, <ClientPaymentCallsPanel reservationId="reservation-1" />));

    await vi.waitFor(() => expect(getMyPaymentCalls).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
