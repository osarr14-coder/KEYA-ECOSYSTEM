import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ClientPaymentCall, ContractVersion, Reservation } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { AcquisitionJourney, acquisitionSteps, nextAction } from './AcquisitionJourney';

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'reservation-1',
    status: 'held',
    status_label: 'Bloquée',
    held_until: '2026-09-28T14:30:00Z',
    price_amount: '30000000.00',
    currency: 'XOF',
    lot: { id: 'lot-1', name: 'Lot A1', surface: '82.00' },
    program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
    organization: { id: 'org-1', name: 'Promoteur Démonstration' },
    cancellation_reason: '',
    validated_at: null,
    created_at: '2026-09-27T14:30:00Z',
    updated_at: '2026-09-27T14:30:00Z',
    ...overrides,
  };
}

const INSTRUCTIONS = {
  beneficiary: 'Compte du programme (simulé) — KEYIMMO AFRIC démonstration', bank: 'Banque de démonstration', iban: 'CI00 DEMO', simulation: true,
};

function call(overrides: Partial<ClientPaymentCall> = {}): ClientPaymentCall {
  return {
    id: 'call-1',
    kind: 'frais',
    kind_label: 'Frais de réservation',
    tier_label: '',
    amount: '100000.00',
    currency: 'XOF',
    issued_at: '2026-09-27T15:00:00Z',
    settled_amount: null,
    settlement: 'to_pay',
    payment_reference: 'KEYA-1A2B3C4D',
    payment_instructions: INSTRUCTIONS,
    notice: null,
    ...overrides,
  };
}

function contract(overrides: Partial<ContractVersion> = {}): ContractVersion {
  return {
    id: 'contract-1', reservation: 'reservation-1', lot_name: 'Lot A1', version: 1, status: 'approved', status_label: 'Approuvé',
    content: 'Contrat fictif.', authored_by: 'adv', submitted_at: null, approved_by: 'adv', approved_at: '2026-09-27T11:00:00Z',
    signed_at: null, simulation: true, created_at: '2026-09-27T09:00:00Z', updated_at: '2026-09-27T11:00:00Z',
    ...overrides,
  };
}

const states = (steps: ReturnType<typeof acquisitionSteps>) => steps.map((step) => step.state);

describe('acquisitionSteps — les 6 étapes dérivées des états serveur (ticket F-074)', () => {
  it('réservation bloquée non validée : étape 2 (validation KEYIMMO) en cours', () => {
    expect(states(acquisitionSteps(reservation(), []))).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('réservation validée : étape 3 (frais) en cours', () => {
    expect(states(acquisitionSteps(reservation({ validated_at: '2026-09-27T15:00:00Z' }), [])))
      .toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('réservée (frais encaissés) et contrat signé : étape 5 (premier versement) en cours', () => {
    const steps = acquisitionSteps(reservation({ status: 'reserved' }), [contract({ status: 'signed_simulated' })]);
    expect(states(steps)).toEqual(['done', 'done', 'done', 'done', 'current', 'upcoming']);
  });

  it('acquisition concrétisée : seul le suivi du chantier reste, en cours', () => {
    expect(states(acquisitionSteps(reservation({ status: 'committed' }), [])))
      .toEqual(['done', 'done', 'done', 'done', 'done', 'current']);
  });
});

describe('nextAction — une seule action attendue du client (ticket F-074)', () => {
  it('non validée, aucun appel : attendre la validation du dossier', () => {
    expect(nextAction(reservation(), [], [])).toEqual({ kind: 'wait', title: 'Validation de votre dossier' });
  });

  it('un appel émis et non couvert : payer cet appel', () => {
    const frais = call();
    expect(nextAction(reservation({ validated_at: 'x' }), [frais], [])).toEqual({ kind: 'pay', call: frais });
  });

  it('virement déclaré : en vérification, jamais une seconde demande de paiement', () => {
    const declared = call({
      notice: {
        id: 'n1', status: 'declared', status_label: 'Déclaré', amount: '100000.00', client_reference: 'VIR-1', paid_on: '2026-09-28', rejection_reason: '',
      },
    });
    expect(nextAction(reservation({ validated_at: 'x' }), [declared], []).kind).toBe('verifying');
  });

  it('un contrat approuvé passe avant un paiement (signer, puis payer le complément)', () => {
    const approved = contract();
    expect(nextAction(reservation({ status: 'reserved' }), [call({ id: 'c2', kind: 'premier_versement' })], [approved]))
      .toEqual({ kind: 'sign', contract: approved });
  });

  it('appels tous couverts, contrat pas encore rédigé : préparation du contrat', () => {
    expect(nextAction(reservation({ status: 'reserved' }), [call({ settlement: 'settled', settled_amount: '100000.00' })], []))
      .toEqual({ kind: 'wait', title: 'Préparation de votre contrat' });
  });
});

describe('AcquisitionJourney — rendu du parcours (ticket F-074)', () => {
  it('affiche le bien, les étapes, la prochaine action « payer » avec les instructions, et le suivi financier', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([call()]),
      getMyContracts: vi.fn().mockResolvedValue([]),
    });
    render(withApiClient(api, (
      <AcquisitionJourney reservation={reservation({ validated_at: '2026-09-27T15:00:00Z' })} onChanged={() => {}} />
    )));

    const hero = screen.getByRole('region', { name: 'Mon bien' });
    expect(hero).toHaveTextContent('Résidence Démonstration Abidjan');
    expect(hero.textContent!.replace(/\s/g, ' ')).toContain('30 000 000 XOF');
    expect(screen.getByTestId('step-fees')).toHaveAttribute('aria-current', 'step');

    const next = await screen.findByTestId('next-action');
    expect(next).toHaveAttribute('data-kind', 'pay');
    expect(next).toHaveTextContent('Régler : Frais de réservation');
    expect(within(next).getByTestId('payment-reference')).toHaveTextContent('KEYA-1A2B3C4D');
    expect(within(next).getByRole('button', { name: "J'ai effectué le virement" })).toBeInTheDocument();

    const summary = screen.getByRole('region', { name: 'Suivi financier' });
    expect(within(summary).getByTestId('summary-call')).toHaveTextContent('À payer');
    expect(within(summary).getByTestId('settled-total').textContent!.replace(/\s/g, ' ')).toBe('0 XOF');
  });

  it('un appel partiellement couvert compte dans le total réglé', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([
        call({ settlement: 'settled', settled_amount: '100000.00' }),
        call({ id: 'c2', kind_label: 'Premier versement', amount: '2900000.00', settlement: 'partial', settled_amount: '1000000.00' }),
      ]),
      getMyContracts: vi.fn().mockResolvedValue([]),
    });
    render(withApiClient(api, <AcquisitionJourney reservation={reservation({ status: 'reserved' })} onChanged={() => {}} />));

    await screen.findByTestId('next-action');
    expect(screen.getByTestId('settled-total').textContent!.replace(/\s/g, ' ')).toBe('1 100 000 XOF');
  });
});
