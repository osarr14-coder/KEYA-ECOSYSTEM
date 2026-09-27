import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useApiClient } from '../api/ApiClientContext';
import type { ClientPaymentCall } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { createMockApiClient, withApiClient } from '../testUtils';
import { CallRow } from './ClientPaymentCallsPanel';

/** Ticket F-074 — même flux de données que `AcquisitionJourney` : les appels
 * sont chargés une fois, chaque `CallRow` est présentationnel. */
function ClientPaymentCallsPanel({ reservationId }: { reservationId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyPaymentCalls(reservationId), [reservationId]);
  if (state.status !== 'success' || state.data.length === 0) return null;
  return (
    <ul>
      {state.data.map((item) => (
        <CallRow key={`${item.id}-${item.settlement}-${item.notice?.status ?? ''}`} call={item} onChanged={state.refetch} />
      ))}
    </ul>
  );
}

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

describe('ClientPaymentCallsPanel — paiement par le client (ticket F-071)', () => {
  const INSTRUCTIONS = {
    beneficiary: 'Compte du programme (simulé) — KEYIMMO AFRIC démonstration',
    bank: 'Banque de démonstration (fictive)', iban: 'CI00 DEMO', simulation: true,
  };

  it('affiche les instructions de virement et déclare le virement du client', async () => {
    const declarePayment = vi.fn().mockResolvedValue({});
    const getMyPaymentCalls = vi.fn()
      .mockResolvedValueOnce([call({
        settled_amount: '0.00', settlement: 'to_pay', payment_reference: 'KEYA-1A2B3C4D',
        payment_instructions: INSTRUCTIONS, notice: null,
      })])
      .mockResolvedValue([call({
        settled_amount: '0.00', settlement: 'to_pay', payment_reference: 'KEYA-1A2B3C4D',
        payment_instructions: INSTRUCTIONS,
        notice: {
          id: 'n-1', status: 'declared', status_label: 'Déclaré', amount: '100000.00',
          client_reference: 'VIR-001', paid_on: '2026-09-28', rejection_reason: '',
        },
      })]);
    const api = createMockApiClient({ getMyPaymentCalls, declarePayment });
    render(withApiClient(api, <ClientPaymentCallsPanel reservationId="reservation-1" />));

    expect(await screen.findByTestId('payment-reference')).toHaveTextContent('KEYA-1A2B3C4D');
    fireEvent.change(screen.getByLabelText('Référence de mon virement'), { target: { value: 'VIR-001' } });
    fireEvent.change(screen.getByLabelText('Date du virement'), { target: { value: '2026-09-28' } });
    fireEvent.click(screen.getByRole('button', { name: "J'ai effectué le virement" }));

    await waitFor(() => expect(declarePayment).toHaveBeenCalledWith('call-1', { client_reference: 'VIR-001', paid_on: '2026-09-28' }));
    expect(await screen.findByTestId('payment-notice')).toHaveTextContent('en attente de confirmation par KEYIMMO');
    expect(screen.queryByRole('button', { name: "J'ai effectué le virement" })).not.toBeInTheDocument();
  });

  it('un virement rejeté affiche le motif et permet de déclarer à nouveau', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([call({
        settled_amount: '0.00', settlement: 'to_pay', payment_reference: 'KEYA-1', payment_instructions: INSTRUCTIONS,
        notice: {
          id: 'n-1', status: 'rejected', status_label: 'Rejeté', amount: '100000.00',
          client_reference: 'VIR-001', paid_on: '2026-09-28', rejection_reason: 'Virement introuvable',
        },
      })]),
    });
    render(withApiClient(api, <ClientPaymentCallsPanel reservationId="reservation-1" />));

    expect(await screen.findByTestId('payment-notice')).toHaveTextContent('Virement introuvable');
    expect(screen.getByRole('button', { name: "J'ai effectué le virement" })).toBeInTheDocument();
  });
});
