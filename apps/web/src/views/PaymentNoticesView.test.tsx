import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Adapté selon PO-2026-09-28-22 : personnes « organisation · rôle », client par son nom, jamais d'e-mail.
import { ApiError } from '../api/client';
import type { AdminReservation, PaymentNotice } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { PaymentNoticesView } from './PaymentNoticesView';

function notice(overrides: Partial<PaymentNotice> = {}): PaymentNotice {
  return {
    id: 'notice-1',
    organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
    program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
    lot: { id: 'lot-1', name: 'Lot A1' },
    reservation: { id: 'reservation-1', status: 'held', status_label: 'Bloquée' },
    client: { id: 'client-1', full_name: 'Awa Koné', role: 'Client' },
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

function renderView(
  canAct: boolean, overrides: Parameters<typeof createMockApiClient>[0] = {}, { signals = true }: { signals?: boolean } = {},
) {
  // PO-2026-09-27-19 : l'écran charge aussi les dossiers (« Enregistrer un encaissement »).
  const api = createMockApiClient({
    listPaymentNotices: vi.fn().mockResolvedValue([notice()]), listReservations: vi.fn().mockResolvedValue([]),
    listReceipts: vi.fn().mockResolvedValue([]), ...overrides,
  });
  render(withApiClient(api, <PaymentNoticesView canAct={canAct} />));
  // Adapté selon PO-2026-09-28-01 : les signalements forment la seconde vue
  // de « Encaissements ».
  if (signals) fireEvent.click(screen.getByRole('button', { name: /Signalements clients/ }));
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

  // Adapté selon PO-2026-09-28-02 : « Clôturer sans rattachement », motif obligatoire.
  it('une clôture sans rattachement exige un motif et l’envoie', async () => {
    const rejectPaymentNotice = vi.fn().mockResolvedValue(notice({ status: 'rejected' }));
    renderView(true, { rejectPaymentNotice });

    const reject = await screen.findByRole('button', { name: 'Clôturer sans rattachement' });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motif de clôture'), { target: { value: 'Virement introuvable' } });
    fireEvent.click(reject);

    await waitFor(() => expect(rejectPaymentNotice).toHaveBeenCalledWith('notice-1', 'org-promoteur', 'Virement introuvable'));
  });

  it('un refus du serveur est affiché tel quel', async () => {
    const enregistrer = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'La référence bancaire simulée doit être celle du relevé.'));
    renderView(true, { confirmPaymentNotice: enregistrer });

    fireEvent.change(await screen.findByLabelText('Référence bancaire simulée'), { target: { value: 'VIR-001' } });
    // Adapté selon PO-2026-09-28-10 : le montant reçu, vide par défaut, est saisi.
    fireEvent.change(screen.getByLabelText('Montant reçu'), { target: { value: '100000' } });
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

const DOSSIER: AdminReservation = {
  id: 'reservation-1', status: 'held', status_label: 'Bloquée', held_until: '2026-09-28T14:30:00Z',
  price_amount: '30000000.00', currency: 'XOF', lot: { id: 'lot-1', name: 'Lot A1', surface: '82.00' },
  program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
  organization: { id: 'org-promoteur', name: 'Constructeur Démonstration' },
  client: { id: 'client-1', full_name: 'Awa Koné', role: 'Client' },
  cancellation_reason: '', cancelled_by: null, created_at: '2026-09-27T14:30:00Z', updated_at: '2026-09-27T14:30:00Z',
};

const CALL = {
  id: 'call-frais', reservation: 'reservation-1', kind: 'frais' as const, kind_label: 'Frais de réservation', tier_code: '',
  tier_label: '', cumulative_cap_percent: null, amount: '100000.00', currency: 'XOF', issued_by: 'adv.demo@keya.test',
  issued_at: '2026-09-27T15:00:00Z', allocated_amount: '100000.00', settled_amount: '0.00', settlement: 'to_pay' as const,
};

describe('PaymentNoticesView — encaissement sans signalement du client (PO-2026-09-27-19, CDC §8.1)', () => {
  it('Finance choisit le dossier, enregistre l’encaissement avec une référence bancaire simulée', async () => {
    const recordReceipt = vi.fn().mockResolvedValue({});
    renderView(true, {
      listPaymentNotices: vi.fn().mockResolvedValue([]),
      listReservations: vi.fn().mockResolvedValue([DOSSIER]),
      getFinanceFile: vi.fn().mockResolvedValue({ reservation: DOSSIER, calls: [{ ...CALL, allocated_amount: '0.00' }], receipts: [] }),
      recordReceipt,
    }, { signals: false });

    const entry = await screen.findByRole('region', { name: 'Enregistrer un encaissement' });
    expect(entry).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Dossier de l’encaissement'), { target: { value: 'reservation-1' } });
    const submit = await screen.findByRole('button', { name: "Enregistrer l'encaissement" });
    expect(submit).toBeDisabled(); // référence bancaire simulée obligatoire
    fireEvent.change(screen.getByLabelText('Référence bancaire simulée'), { target: { value: 'SIM-ENC-0100' } });
    fireEvent.change(screen.getByLabelText('Montant reçu'), { target: { value: '150000' } });
    fireEvent.click(submit);

    await waitFor(() => expect(recordReceipt).toHaveBeenCalledWith('reservation-1', 'org-promoteur', expect.objectContaining({
      bank_reference: 'SIM-ENC-0100', amount: '150000',
    })));
  });

  it('T12 : justificatif fictif, affectations à plusieurs appels et montant non affecté visibles', async () => {
    renderView(true, {
      listPaymentNotices: vi.fn().mockResolvedValue([]),
      listReservations: vi.fn().mockResolvedValue([DOSSIER]),
      getFinanceFile: vi.fn().mockResolvedValue({
        reservation: DOSSIER,
        calls: [CALL, { ...CALL, id: 'call-pv', kind: 'premier_versement', kind_label: 'Complément du premier versement', amount: '2900000.00', allocated_amount: '40000.00' }],
        receipts: [{
          id: 'receipt-1', bank_reference: 'SIM-ENC-0100', amount: '150000.00', currency: 'XOF', received_on: '2026-09-28',
          status: 'bank_executed_sim', status_label: 'Reçu en banque (simulé)', recorded_by: 'finance.demo@keya.test',
          recorded_at: '2026-09-28T09:00:00Z', reconciled_by: null, reconciled_at: null, unallocated_amount: '10000.00',
          allocations: [
            { id: 'a1', payment_call: 'call-frais', amount: '100000.00', created_at: '2026-09-28T09:01:00Z' },
            { id: 'a2', payment_call: 'call-pv', amount: '40000.00', created_at: '2026-09-28T09:02:00Z' },
          ],
          simulation: true,
        }],
      }),
    }, { signals: false });

    fireEvent.change(await screen.findByLabelText('Dossier de l’encaissement'), { target: { value: 'reservation-1' } });
    const block = await screen.findByTestId('receipt-block');
    expect(block).toHaveTextContent('Justificatif bancaire fictif');
    expect(block).toHaveTextContent('SIMULÉ — SANS VALEUR OPÉRATIONNELLE');
    const allocations = screen.getByTestId('receipt-allocations').textContent!.replace(/\s/g, ' ');
    expect(allocations).toContain('100 000 XOF → Frais de réservation');
    expect(allocations).toContain('40 000 XOF → Complément du premier versement');
    expect(screen.getByTestId('receipt-unallocated').textContent!.replace(/\s/g, ' ')).toBe('10 000 XOF');
    expect(block).toHaveTextContent('reste visible après rapprochement');
  });
});

// PO-2026-09-28-01, -02, -10 : deux vues, rattachement, montant lu au relevé.
describe('PaymentNoticesView — encaissements et signalements (PO-2026-09-28-01/02/10)', () => {
  it('s’ouvre sur les encaissements enregistrés, en relevé', async () => {
    renderView(true, {
      listReceipts: vi.fn().mockResolvedValue([{
        ...RECEIPT, simulation: true, organization_id: 'org-promoteur',
        program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' }, lot: { id: 'lot-1', name: 'Lot A1' },
        reservation: { id: 'reservation-1', status: 'reserved', status_label: 'Réservée' },
        client: { id: 'client-1', full_name: 'Awa Koné', role: 'Client' },
        notices: [{ id: 'notice-1', client_reference: 'VIR-001', status: 'confirmed', status_label: 'Traité — encaissement enregistré' }],
      }]),
    }, { signals: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Encaissements' })).toBeInTheDocument();
    const row = await screen.findByTestId('ledger-receipt');
    expect(row).toHaveTextContent('SIM-ENC-0009');
    expect(row).toHaveTextContent('Awa Koné — Lot A1');
    expect(row).toHaveTextContent('28 sept. 2026');
    expect(row).toHaveTextContent('VIR-001');
  });

  it('le montant reçu est vide par défaut : il se lit au relevé', async () => {
    renderView(true);
    expect(await screen.findByLabelText('Montant reçu')).toHaveValue('');
  });

  it('rattache un signalement à un encaissement déjà enregistré et en affiche la référence', async () => {
    const attachPaymentNotice = vi.fn().mockResolvedValue(notice({ status: 'confirmed', receipt: RECEIPT }));
    const listPaymentNotices = vi.fn()
      .mockResolvedValueOnce([notice({
        attachable_receipts: [{ id: 'receipt-1', bank_reference: 'SIM-ENC-0009', amount: '150000.00', currency: 'XOF', received_on: '2026-09-28' }],
      })])
      .mockResolvedValue([notice({ status: 'confirmed', status_label: 'Traité — encaissement enregistré', receipt: RECEIPT })]);
    renderView(true, { attachPaymentNotice, listPaymentNotices });

    const select = await screen.findByLabelText('Encaissement à rattacher');
    expect(select.textContent!.replace(/\s/g, ' ')).toContain('SIM-ENC-0009 — 150 000 XOF — reçu le 28 sept. 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Rattacher' }));
    await waitFor(() => expect(attachPaymentNotice).toHaveBeenCalledWith('notice-1', 'org-promoteur', 'receipt-1'));
    expect(await screen.findByTestId('notice-receipt-reference')).toHaveTextContent('SIM-ENC-0009');
  });

  it('sans encaissement enregistré sur le dossier, le rattachement l’explique', async () => {
    renderView(true);
    expect(await screen.findByText(/Aucun encaissement enregistré sur ce dossier/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rattacher' })).not.toBeInTheDocument();
  });
});
