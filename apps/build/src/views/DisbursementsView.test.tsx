import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReceivedDisbursement } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { DisbursementsView } from './DisbursementsView';

function disbursement(overrides: Partial<ReceivedDisbursement> = {}): ReceivedDisbursement {
  return {
    id: 'disbursement-1',
    organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
    program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
    lot: { id: 'lot-1', name: 'Lot A1' },
    milestone: { id: 'milestone-1', code: 'fondations', label: 'Fondations' },
    amount: '1000000.00',
    currency: 'XOF',
    flow_status: 'bank_executed_sim',
    flow_status_label: 'Exécuté en banque (simulé)',
    bank_reference: 'SORTIE-001',
    executed_on: '2026-10-01',
    beneficiary_confirmation: 'absent',
    beneficiary_confirmed_at: null,
    reconciliation_reason: '',
    simulation: true,
    ...overrides,
  };
}

describe('DisbursementsView — paiements reçus (ticket F-068)', () => {
  it('liste les paiements reçus et confirme la réception', async () => {
    const confirmDisbursement = vi.fn().mockResolvedValue(disbursement({ beneficiary_confirmation: 'confirmed' }));
    const listReceivedDisbursements = vi.fn()
      .mockResolvedValueOnce([disbursement()])
      .mockResolvedValue([disbursement({
        beneficiary_confirmation: 'confirmed', flow_status: 'beneficiary_confirmed_sim',
        flow_status_label: 'Confirmé par le bénéficiaire (simulé)',
      })]);
    const api = createMockApiClient({ listReceivedDisbursements, confirmDisbursement });
    render(withApiClient(api, <DisbursementsView />));

    // Adapté selon PO-2026-09-27-20 (DESIGN_SYSTEM §9) : référence en Plex Mono
    // (élément distinct) et date au format « 1 oct. 2026 ».
    expect(await screen.findByTestId('disbursement-execution'))
      .toHaveTextContent(/1\s000\s000 XOF · référence SORTIE-001 du 1 oct\. 2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la réception' }));

    await waitFor(() => expect(confirmDisbursement).toHaveBeenCalledWith('disbursement-1'));
    expect(await screen.findByText('Réception confirmée.')).toBeInTheDocument();
    expect(screen.getByTestId('disbursement-flow')).toHaveTextContent('Confirmé par le bénéficiaire (simulé)');
  });

  it('place le focus sur « Réception confirmée. » après la confirmation (T20, P2)', async () => {
    const listReceivedDisbursements = vi.fn()
      .mockResolvedValueOnce([disbursement(), disbursement({ id: 'disbursement-2', bank_reference: 'SORTIE-002' })])
      .mockResolvedValue([
        disbursement({ beneficiary_confirmation: 'confirmed' }),
        disbursement({ id: 'disbursement-2', bank_reference: 'SORTIE-002' }),
      ]);
    const api = createMockApiClient({
      listReceivedDisbursements,
      confirmDisbursement: vi.fn().mockResolvedValue(disbursement({ beneficiary_confirmation: 'confirmed' })),
    });
    render(withApiClient(api, <DisbursementsView />));

    const buttons = await screen.findAllByRole('button', { name: 'Confirmer la réception' });
    buttons[0].focus();
    fireEvent.click(buttons[0]);

    const confirmation = await screen.findByText('Réception confirmée.');
    await waitFor(() => expect(confirmation).toHaveFocus());
    expect(confirmation).toHaveAttribute('role', 'status');
    // L'autre paiement reste à confirmer, son bouton n'a pas pris le focus.
    expect(screen.getByRole('button', { name: 'Confirmer la réception' })).not.toHaveFocus();
  });

  it('état vide explicite', async () => {
    const api = createMockApiClient({ listReceivedDisbursements: vi.fn().mockResolvedValue([]) });
    render(withApiClient(api, <DisbursementsView />));

    expect(await screen.findByTestId('no-disbursements')).toBeInTheDocument();
  });
});
