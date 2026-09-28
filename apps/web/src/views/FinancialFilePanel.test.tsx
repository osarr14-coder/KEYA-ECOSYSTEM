import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Adapté selon PO-2026-09-28-22 : personnes « organisation · rôle », client par son nom, jamais d'e-mail.
import { ApiError } from '../api/client';
import type {
  AdminReservation, CustomerReceipt, FinanceFile, PaymentCall, TeamPaymentCalls,
} from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { FinancialFilePanel } from './FinancialFilePanel';

const reservation: AdminReservation = {
  id: 'reservation-1',
  status: 'held',
  status_label: 'Bloquée',
  held_until: '2026-09-28T14:30:00Z',
  price_amount: '30000000.00',
  currency: 'XOF',
  lot: { id: 'lot-1', name: 'Lot A1', surface: '82.00' },
  program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
  organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
  client: { id: 'client-1', full_name: 'Awa Koné', role: 'Client' },
  cancellation_reason: '',
  cancelled_by: null,
  created_at: '2026-09-27T14:30:00Z',
  updated_at: '2026-09-27T14:30:00Z',
};

function call(overrides: Partial<PaymentCall> = {}): PaymentCall {
  return {
    id: 'call-frais',
    reservation: 'reservation-1',
    kind: 'frais',
    kind_label: 'Frais de réservation',
    tier_code: '',
    tier_label: '',
    cumulative_cap_percent: null,
    amount: '100000.00',
    currency: 'XOF',
    issued_by: 'adv.demo@keya.test',
    issued_at: '2026-09-27T15:00:00Z',
    allocated_amount: '0.00',
    settled_amount: '0.00',
    settlement: 'to_pay',
    ...overrides,
  };
}

function receipt(overrides: Partial<CustomerReceipt> = {}): CustomerReceipt {
  return {
    id: 'receipt-1',
    bank_reference: 'SIM-001',
    amount: '100000.00',
    currency: 'XOF',
    received_on: '2026-09-28',
    status: 'bank_executed_sim',
    status_label: 'Reçu en banque (simulé)',
    recorded_by: 'finance.demo@keya.test',
    recorded_at: '2026-09-28T09:00:00Z',
    reconciled_by: null,
    reconciled_at: null,
    unallocated_amount: '100000.00',
    allocations: [],
    simulation: true,
    ...overrides,
  };
}

function file(overrides: Partial<FinanceFile> = {}): FinanceFile {
  return {
    reservation: { id: 'reservation-1', status: 'held', status_label: 'Bloquée' },
    calls: [call()],
    receipts: [],
    ...overrides,
  };
}

const team: TeamPaymentCalls = {
  calls: [],
  candidates: [{
    kind: 'premier_versement',
    kind_label: 'Premier versement',
    tier_code: '',
    tier_label: '',
    cumulative_cap_percent: '10.00',
    amount: '2900000.00',
    available: true,
    reason: null,
  }],
  blocking_reason: null,
};

function renderPanel(
  permissions: { canIssueCalls: boolean; canRecordMovements: boolean },
  overrides: Parameters<typeof createMockApiClient>[0] = {},
) {
  const onChanged = vi.fn();
  const api = createMockApiClient({
    getFinanceFile: vi.fn().mockResolvedValue(file()),
    getTeamPaymentCalls: vi.fn().mockResolvedValue(team),
    ...overrides,
  });
  render(withApiClient(api, <FinancialFilePanel reservation={reservation} onChanged={onChanged} {...permissions} />));
  return { api, onChanged };
}

describe('FinancialFilePanel — dossier financier (ticket F-068)', () => {
  it("l'ADV voit les appels et émet le prochain appel calculé par le serveur, sans formulaire d'encaissement", async () => {
    const issuePaymentCall = vi.fn().mockResolvedValue({});
    const { onChanged } = renderPanel({ canIssueCalls: true, canRecordMovements: false }, { issuePaymentCall });

    expect(await screen.findByText('Frais de réservation')).toBeInTheDocument();
    expect(screen.getByTestId('call-settlement')).toHaveTextContent('À payer');
    expect(screen.queryByRole('form', { name: /Enregistrer un encaissement/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Émettre l'appel : Premier versement/ }));
    await waitFor(() => expect(issuePaymentCall).toHaveBeenCalledWith('reservation-1', 'org-promoteur', 'premier_versement', ''));
    expect(onChanged).toHaveBeenCalled();
  });

  it('Finance ne voit pas les appels à émettre (jamais demandés au serveur)', async () => {
    const { api } = renderPanel({ canIssueCalls: false, canRecordMovements: true });

    await screen.findByText('Frais de réservation');
    expect(api.getTeamPaymentCalls).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Émettre l'appel/ })).not.toBeInTheDocument();
  });

  it('Finance enregistre un encaissement avec référence, montant et date', async () => {
    const recordReceipt = vi.fn().mockResolvedValue(receipt());
    renderPanel({ canIssueCalls: false, canRecordMovements: true }, { recordReceipt });

    fireEvent.change(await screen.findByLabelText('Référence bancaire simulée'), { target: { value: ' SIM-001 ' } });
    fireEvent.change(screen.getByLabelText('Montant reçu'), { target: { value: '100000' } });
    // Adapté selon PO-2026-09-28-11 : saisie de date au format F06 (jour · mois · année).
    fireEvent.change(screen.getByLabelText('Date de réception — année'), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText('Date de réception — mois'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Date de réception — jour'), { target: { value: '28' } });
    fireEvent.click(screen.getByRole('button', { name: "Enregistrer l'encaissement" }));

    await waitFor(() => expect(recordReceipt).toHaveBeenCalledWith('reservation-1', 'org-promoteur', {
      bank_reference: 'SIM-001', amount: '100000', received_on: '2026-09-28',
    }));
  });

  it('Finance affecte le solde non affecté à un appel puis rapproche', async () => {
    const allocateReceipt = vi.fn().mockResolvedValue({});
    const reconcileReceipt = vi.fn().mockResolvedValue({});
    renderPanel(
      { canIssueCalls: false, canRecordMovements: true },
      { getFinanceFile: vi.fn().mockResolvedValue(file({ receipts: [receipt()] })), allocateReceipt, reconcileReceipt },
    );

    expect(await screen.findByTestId('receipt-status')).toHaveTextContent('Reçu en banque (simulé)');
    fireEvent.click(screen.getByRole('button', { name: 'Affecter' }));
    await waitFor(() => expect(allocateReceipt).toHaveBeenCalledWith('receipt-1', 'org-promoteur', 'call-frais', '100000.00'));

    fireEvent.click(screen.getByRole('button', { name: 'Rapprocher' }));
    await waitFor(() => expect(reconcileReceipt).toHaveBeenCalledWith('receipt-1', 'org-promoteur'));
  });

  it('un refus du serveur (double imputation) est affiché tel quel', async () => {
    const allocateReceipt = vi.fn().mockRejectedValue(
      new ApiError(409, 'conflict', 'Montant supérieur au reste à couvrir sur cet appel (0 XOF) : aucune double imputation.'),
    );
    renderPanel(
      { canIssueCalls: false, canRecordMovements: true },
      { getFinanceFile: vi.fn().mockResolvedValue(file({ receipts: [receipt()] })), allocateReceipt },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Affecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('aucune double imputation');
  });

  it("n'affiche rien pour une réservation expirée ou annulée", () => {
    const api = createMockApiClient({
      getFinanceFile: vi.fn().mockResolvedValue(file()),
    });
    const { container } = render(withApiClient(api, (
      <FinancialFilePanel
        reservation={{ ...reservation, status: 'expired' }}
        canIssueCalls
        canRecordMovements={false}
        onChanged={vi.fn()}
      />
    )));
    expect(container).toBeEmptyDOMElement();
  });
});
