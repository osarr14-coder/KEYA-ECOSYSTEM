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
    status_label: 'Déclaré — en attente de confirmation',
    created_at: '2026-09-28T09:00:00Z',
    processed_by: null,
    processed_at: null,
    rejection_reason: '',
    simulation: true,
    ...overrides,
  };
}

function renderView(canAct: boolean, overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({ listPaymentNotices: vi.fn().mockResolvedValue([notice()]), ...overrides });
  render(withApiClient(api, <PaymentNoticesView canAct={canAct} />));
  return { api };
}

describe('PaymentNoticesView — virements déclarés (ticket F-071)', () => {
  it('Finance confirme la réception avec la référence et la date du relevé', async () => {
    const confirmPaymentNotice = vi.fn().mockResolvedValue(notice({ status: 'confirmed' }));
    const { api } = renderView(true, { confirmPaymentNotice });

    expect(await screen.findByText('VIR-001')).toBeInTheDocument();
    expect(api.listPaymentNotices).toHaveBeenCalledWith('declared');
    fireEvent.change(screen.getByLabelText('Référence sur le relevé'), { target: { value: 'RELEVE-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la réception' }));

    await waitFor(() => expect(confirmPaymentNotice).toHaveBeenCalledWith('notice-1', 'org-promoteur', {
      bank_reference: 'RELEVE-9', received_on: '2026-09-28',
    }));
  });

  it('le rejet exige un motif et l’envoie', async () => {
    const rejectPaymentNotice = vi.fn().mockResolvedValue(notice({ status: 'rejected' }));
    renderView(true, { rejectPaymentNotice });

    const reject = await screen.findByRole('button', { name: 'Rejeter' });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motif du rejet'), { target: { value: 'Virement introuvable' } });
    fireEvent.click(reject);

    await waitFor(() => expect(rejectPaymentNotice).toHaveBeenCalledWith('notice-1', 'org-promoteur', 'Virement introuvable'));
  });

  it('un refus du serveur est affiché tel quel', async () => {
    const confirmPaymentNotice = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'Avis déjà traité (confirmé par finance).'));
    renderView(true, { confirmPaymentNotice });

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer la réception' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Avis déjà traité');
  });

  it("l'ADV lit sans aucune action", async () => {
    renderView(false);
    expect(await screen.findByTestId('notice-status')).toHaveTextContent('en attente de confirmation');
    expect(screen.queryByRole('button', { name: 'Confirmer la réception' })).not.toBeInTheDocument();
  });
});
