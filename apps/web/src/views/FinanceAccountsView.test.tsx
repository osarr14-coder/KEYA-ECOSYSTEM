import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { Disbursement, ProgramAccount, ProgramAccountSummary } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { FinanceAccountsView, NO_CONFIRMATION_REASON } from './FinanceAccountsView';

const summary: ProgramAccountSummary = {
  organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
  program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
  balance: {
    received: '3000000.00', executed: '0.00', reserved: '0.00', available: '3000000.00', currency: 'XOF', simulation: true,
  },
};

function disbursement(overrides: Partial<Disbursement> = {}): Disbursement {
  return {
    id: 'disbursement-1',
    organization: summary.organization,
    program: summary.program,
    lot: { id: 'lot-1', name: 'Lot A1' },
    milestone: { id: 'milestone-1', code: 'fondations', label: 'Fondations' },
    beneficiary_organization: { id: 'org-constructeur', name: 'Constructeur Démonstration' },
    amount: '1000000.00',
    currency: 'XOF',
    status: 'draft',
    status_label: 'Brouillon',
    flow_status: 'planned',
    flow_status_label: 'Prévu',
    bank_reference: null,
    executed_on: null,
    executed_at: null,
    executed_by: null,
    beneficiary_confirmation: null,
    beneficiary_confirmed_at: null,
    reconciled_at: null,
    reconciled_by: null,
    reconciliation_reason: '',
    cancel_reason: '',
    cancelled_at: null,
    eligible_at: null,
    prepared_by: 'finance.demo@keya.test',
    created_at: '2026-09-28T10:00:00Z',
    simulation: true,
    ...overrides,
  };
}

function account(overrides: Partial<ProgramAccount> = {}): ProgramAccount {
  return {
    ...summary,
    milestones: [
      {
        id: 'milestone-1', code: 'fondations', label: 'Fondations', order: 1,
        lot: { id: 'lot-1', name: 'Lot A1' },
        beneficiary_organization: { id: 'org-constructeur', name: 'Constructeur Démonstration' },
        disbursable: true, blockers: [], open_disbursement: null,
      },
      {
        id: 'milestone-2', code: 'gros_oeuvre', label: 'Gros œuvre', order: 2,
        lot: { id: 'lot-1', name: 'Lot A1' },
        beneficiary_organization: { id: 'org-constructeur', name: 'Constructeur Démonstration' },
        disbursable: false, blockers: ['jalon non accepté techniquement dans sa version courante'], open_disbursement: null,
      },
    ],
    disbursements: [],
    ...overrides,
  };
}

function renderView(canAct: boolean, overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    listProgramAccounts: vi.fn().mockResolvedValue([summary]),
    getProgramAccount: vi.fn().mockResolvedValue(account()),
    ...overrides,
  });
  render(withApiClient(api, <FinanceAccountsView canAct={canAct} />));
  return { api };
}

describe('FinanceAccountsView — comptes et décaissements (ticket F-068)', () => {
  it('affiche le solde détaillé et les conditions techniques de chaque jalon', async () => {
    const { api } = renderView(true);

    expect(await screen.findByTestId('balance-Disponible')).toHaveTextContent(/3\s000\s000 XOF/);
    expect(api.getProgramAccount).toHaveBeenCalledWith('program-1', 'org-promoteur');
    expect(screen.getByTestId('milestone-conditions-fondations')).toHaveTextContent('Réunies');
    // Jalons non actionnables masqués par défaut, visibles sur demande.
    expect(screen.queryByTestId('milestone-conditions-gros_oeuvre')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Afficher tous les jalons (2)'));
    expect(screen.getByTestId('milestone-conditions-gros_oeuvre')).toHaveTextContent('jalon non accepté');
  });

  it('Finance prépare un décaissement sur un jalon', async () => {
    const prepareDisbursement = vi.fn().mockResolvedValue(disbursement());
    renderView(true, { prepareDisbursement });

    fireEvent.change(await screen.findByLabelText('Montant à décaisser — Lot A1 Fondations'), { target: { value: '1000000' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Préparer' })[0]);

    await waitFor(() => expect(prepareDisbursement).toHaveBeenCalledWith('org-promoteur', 'milestone-1', '1000000'));
  });

  it("le contrôle d'éligibilité refusé (réserve ouverte) est affiché tel quel", async () => {
    const checkDisbursementEligibility = vi.fn().mockRejectedValue(
      new ApiError(409, 'conflict', 'Décaissement non éligible : réserve ouverte sur le lot.'),
    );
    renderView(true, {
      getProgramAccount: vi.fn().mockResolvedValue(account({ disbursements: [disbursement()] })),
      checkDisbursementEligibility,
    });

    fireEvent.click(await screen.findByRole('button', { name: "Contrôler l'éligibilité" }));
    await waitFor(() => expect(checkDisbursementEligibility).toHaveBeenCalledWith('disbursement-1', 'org-promoteur'));
    expect(await screen.findByRole('alert')).toHaveTextContent('réserve ouverte sur le lot');
  });

  it('une demande éligible s’exécute avec une référence et une date', async () => {
    const executeDisbursement = vi.fn().mockResolvedValue(disbursement({ status: 'executed_sim' }));
    renderView(true, {
      getProgramAccount: vi.fn().mockResolvedValue(account({
        disbursements: [disbursement({ status: 'eligible', status_label: 'Éligible (montant réservé)' })],
      })),
      executeDisbursement,
    });

    fireEvent.change(await screen.findByLabelText('Référence de sortie'), { target: { value: 'SORTIE-001' } });
    // Adapté selon PO-2026-09-28-11 : saisie de date au format F06 (jour · mois · année).
    fireEvent.change(screen.getByLabelText("Date d'exécution — année"), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText("Date d'exécution — mois"), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText("Date d'exécution — jour"), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exécuter (simulé)' }));
    // Adapté selon PO-2026-09-28-60 (P23) : confirmation explicite avant l'appel.
    expect(executeDisbursement).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Aucune annulation après exécution.');
    fireEvent.click(screen.getByRole('button', { name: "Confirmer l'exécution" }));

    await waitFor(() => expect(executeDisbursement).toHaveBeenCalledWith('disbursement-1', 'org-promoteur', {
      bank_reference: 'SORTIE-001', executed_on: '2026-10-01',
    }));
  });

  it('sans confirmation du bénéficiaire, le rapprochement envoie le motif du CDC et l’absence reste affichée', async () => {
    const reconcileDisbursement = vi.fn().mockResolvedValue(disbursement());
    renderView(true, {
      getProgramAccount: vi.fn().mockResolvedValue(account({
        disbursements: [disbursement({
          status: 'executed_sim', status_label: 'Exécuté (simulé)', flow_status: 'bank_executed_sim',
          flow_status_label: 'Exécuté en banque (simulé)', bank_reference: 'SORTIE-001', executed_on: '2026-10-01',
          beneficiary_confirmation: 'absent',
        })],
      })),
      reconcileDisbursement,
    });

    expect(await screen.findByTestId('disbursement-confirmation')).toHaveTextContent('Confirmation du bénéficiaire : absente');
    expect(screen.queryByRole('button', { name: 'Rapprocher' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Rapprocher sans confirmation/ }));

    await waitFor(() => expect(reconcileDisbursement).toHaveBeenCalledWith('disbursement-1', 'org-promoteur', NO_CONFIRMATION_REASON));
  });

  it("l'ADV et l'admin lisent sans aucune action", async () => {
    renderView(false, {
      getProgramAccount: vi.fn().mockResolvedValue(account({ disbursements: [disbursement()] })),
    });

    expect(await screen.findByTestId('disbursement-status')).toHaveTextContent('Brouillon');
    expect(screen.queryByRole('button', { name: 'Préparer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Contrôler l'éligibilité" })).not.toBeInTheDocument();
  });
});

describe('FinanceAccountsView — montants décomposables (audit UI R1, F03)', () => {
  it('chaque montant ouvre la liste des mouvements qui le composent ; « Disponible » montre son calcul', async () => {
    renderView(true, {
      getProgramAccount: vi.fn().mockResolvedValue(account({
        receipts: [
          {
            id: 'r1', bank_reference: 'SIM-ENC-0001', amount: '100000.00', currency: 'XOF', received_on: '2026-09-28',
            status_label: 'Rapproché (simulé)', lot: 'Lot A2', client: 'Yao Kouassi',
          },
          {
            id: 'r2', bank_reference: 'SIM-ENC-0002', amount: '2900000.00', currency: 'XOF', received_on: '2026-09-29',
            status_label: 'Rapproché (simulé)', lot: 'Lot A2', client: 'Yao Kouassi',
          },
        ],
        disbursements: [disbursement({ status: 'eligible', status_label: 'Éligible (montant réservé)' })],
      })),
    });

    fireEvent.click(await screen.findByTestId('balance-Encaissements rapprochés'));
    const detail = screen.getByTestId('balance-detail');
    expect(detail).toHaveTextContent('SIM-ENC-0001');
    expect(detail).toHaveTextContent('SIM-ENC-0002');
    expect(detail).toHaveTextContent('reçu le 28 sept. 2026');

    fireEvent.click(screen.getByTestId('balance-Réservé (demandes éligibles)'));
    expect(screen.getByTestId('balance-detail')).toHaveTextContent('Lot A1 — Fondations');

    fireEvent.click(screen.getByTestId('balance-Disponible'));
    expect(screen.getByTestId('balance-formula').textContent!.replace(/\s/g, ' '))
      .toBe('Disponible = encaissements rapprochés 3 000 000 XOF − sorties exécutées 0 XOF − réservé 0 XOF = 3 000 000 XOF');
  });
});
