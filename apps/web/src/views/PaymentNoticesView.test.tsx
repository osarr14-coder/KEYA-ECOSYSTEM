import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { PaymentNotice } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { PaymentNoticesView } from './PaymentNoticesView';

function notice(overrides: Partial<PaymentNotice> = {}): PaymentNotice {
  return {
    id: 'notice-1',
    organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
    program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
    lot: { id: 'lot-1', name: 'Lot A1' },
    reservation: { id: 'reservation-1', status: 'held', status_label: 'Bloquée' },
    client: { id: 'client-1', email: 'client1.demo@keya.test', full_name: 'Awa Koné' },
    payment_call: { id: 'call-1', kind: 'frais', kind_label: 'Frais de réservation', tier_label: '', amount: '100000.00' },
    amount: '100000.00',
    currency: 'XOF',
    client_reference: 'VIR-001',
    paid_on: '2026-09-28',
    status: 'declared',
    status_label: 'Signalé par le client — non encaissé',
    created_at: '2026-09-28T09:00:00Z',
    processed_by: null,
    processed_at: null,
    rejection_reason: '',
    simulation: true,
    receipt: null,
    ...overrides,
  };
}

function renderView(canAct: boolean, overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({ listPaymentNotices: vi.fn().mockResolvedValue([notice()]), ...overrides });
  render(withApiClient(api, <PaymentNoticesView canAct={canAct} />));
  return { api };
}

const RECEIPT = {
  id: 'receipt-1', bank_reference: 'SIM-ENC-0009', amount: '150000.00', currency: 'XOF', received_on: '2026-09-28',
  status: 'reconciled_sim' as const, status_label: 'Rapproché (simulé)', recorded_by: 'finance.demo@keya.test',
  recorded_at: '2026-09-28T10:15:00Z', reconciled_at: '2026-09-28T10:15:00Z',
  allocations: [{ id: 'alloc-1', payment_call: 'Frais de réservation', amount: '100000.00' }],
  unallocated_amount: '50000.00',
};

// Audit UI R1 (F01, F02, PO-2026-09-27-05) : le signalement du client n'est
// qu'un avis ; Finance enregistre l'encaissement simulé à partir du relevé
// fictif. Remplace la « confirmation » à référence facultative (F-071).
describe('PaymentNoticesView — virements signalés, encaissement par Finance (audit F01/F02)', () => {
  it('Finance enregistre l’encaissement : référence bancaire simulée, montant et date reçus', async () => {
    const enregistrer = vi.fn().mockResolvedValue(notice({ status: 'confirmed', receipt: RECEIPT }));
    const { api } = renderView(true, { confirmPaymentNotice: enregistrer });

    expect(await screen.findByText('VIR-001')).toBeInTheDocument();
    expect(api.listPaymentNotices).toHaveBeenCalledWith('declared');
    const button = screen.getByRole('button', { name: 'Enregistrer l’encaissement' });
    expect(button).toBeDisabled(); // référence bancaire simulée obligatoire
    fireEvent.change(screen.getByLabelText('Référence bancaire simulée'), { target: { value: 'SIM-ENC-0009' } });
    fireEvent.change(screen.getByLabelText('Montant reçu'), { target: { value: '150000' } });
    fireEvent.click(button);

    await waitFor(() => expect(enregistrer).toHaveBeenCalledWith('notice-1', 'org-promoteur', {
      bank_reference: 'SIM-ENC-0009', received_on: '2026-09-28', amount: '150000',
    }));
  });

  it('un virement introuvable au relevé exige un motif et l’envoie', async () => {
    const rejectPaymentNotice = vi.fn().mockResolvedValue(notice({ status: 'rejected' }));
    renderView(true, { rejectPaymentNotice });

    const reject = await screen.findByRole('button', { name: 'Introuvable au relevé' });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motif du rejet'), { target: { value: 'Virement introuvable' } });
    fireEvent.click(reject);

    await waitFor(() => expect(rejectPaymentNotice).toHaveBeenCalledWith('notice-1', 'org-promoteur', 'Virement introuvable'));
  });

  it('un refus du serveur est affiché tel quel', async () => {
    const enregistrer = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'La référence bancaire simulée doit être celle du relevé.'));
    renderView(true, { confirmPaymentNotice: enregistrer });

    fireEvent.change(await screen.findByLabelText('Référence bancaire simulée'), { target: { value: 'VIR-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’encaissement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('celle du relevé');
  });

  it('un signalement traité montre le justificatif fictif, l’état §8.3, les affectations et le non affecté', async () => {
    renderView(false, {
      listPaymentNotices: vi.fn().mockResolvedValue([
        notice({ status: 'confirmed', status_label: 'Traité — encaissement enregistré', receipt: RECEIPT }),
      ]),
    });

    const proof = await screen.findByTestId('receipt-proof');
    expect(proof).toHaveTextContent('Justificatif bancaire fictif');
    expect(screen.getByTestId('receipt-status')).toHaveTextContent('Rapproché (simulé)');
    expect(screen.getByTestId('receipt-bank-reference')).toHaveTextContent('SIM-ENC-0009');
    expect(proof.textContent!.replace(/\s/g, ' ')).toContain('100 000 XOF → Frais de réservation');
    expect(screen.getByTestId('receipt-unallocated').textContent!.replace(/\s/g, ' ')).toBe('50 000 XOF');
    expect(proof).toHaveTextContent('SIMULÉ — SANS VALEUR OPÉRATIONNELLE');
    expect(proof).toHaveTextContent('28 sept. 2026, 10:15 (GMT, Abidjan)');
  });

  it('F06 : dates au format unique, jamais AAAA-MM-JJ', async () => {
    renderView(false);
    const card = (await screen.findByTestId('notice-status')).closest('section')!;
    expect(card.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(card).toHaveTextContent('28 sept. 2026');
  });

  it('lecture seule : aucune action sans le droit Finance', async () => {
    renderView(false);
    expect(await screen.findByTestId('notice-status')).toHaveTextContent('non encaissé');
    expect(screen.queryByRole('button', { name: 'Enregistrer l’encaissement' })).not.toBeInTheDocument();
  });
});

describe('PaymentNoticesView — chiffres clés (ticket F-078)', () => {
  it('compte les virements à confirmer et totalise leur montant', async () => {
    renderView(true, {
      listPaymentNotices: vi.fn().mockResolvedValue([
        notice(),
        notice({ id: 'notice-2', amount: '2900000.00', client_reference: 'VIR-002' }),
        notice({ id: 'notice-3', status: 'confirmed', status_label: 'Traité — encaissement enregistré' }),
      ]),
    });

    expect(await screen.findByTestId('kf-to-confirm-value')).toHaveTextContent('2');
    expect(screen.getByTestId('kf-to-confirm-amount-value').textContent!.replace(/\s/g, ' ')).toBe('3 000 000 XOF');
  });
});
