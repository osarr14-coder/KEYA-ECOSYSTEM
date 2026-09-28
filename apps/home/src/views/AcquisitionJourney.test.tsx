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

const SCHEDULE = {
  version: 1,
  country_pack: 'CI',
  first_payment_amount: '3000000',
  rows: [
    {
      code: 'reservation', label: 'Premier versement', amount: '3000000', fee_included: '100000', cumulative_cap_percent: '10.00',
      condition: 'Frais de réservation inclus, puis complément après encaissement des frais.',
      planned_on: '2026-09-27',
    },
    {
      code: 'fondations', label: 'Palier « Fondations »', amount: '12000000', fee_included: null, cumulative_cap_percent: '50.00',
      condition: 'Appel émis par le gestionnaire, après acceptation technique du jalon « Fondations ».',
      planned_on: '2026-12-26',
    },
  ],
};

// Audit UI R1 — C05 (PO-2026-09-27-02) : plus d'étape « Validation KEYIMMO » ;
// C03 : frais inclus dans le premier versement ; C01 : étape contrat fidèle
// à l'état réel du contrat. Remplace les 6 étapes du ticket F-074.
describe('acquisitionSteps — étapes dérivées des états serveur (audit UI R1, C01/C03/C05)', () => {
  it('aucune étape « Validation KEYIMMO » : réservation, premier versement, contrat, chantier', () => {
    expect(acquisitionSteps(reservation(), []).map((step) => step.label))
      .toEqual(['Réservation', 'Premier versement', 'Préparation du contrat', 'Suivi du chantier']);
  });

  it('bloquée : le premier versement est en cours, frais inclus, avec le reste à couvrir', () => {
    const steps = acquisitionSteps(reservation({ payment_schedule: SCHEDULE }), [], [call()]);
    expect(states(steps)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(steps[1].caption!.replace(/\s/g, ' ')).toBe('0 XOF / 3 000 000 XOF — reste 3 000 000 XOF (frais inclus)');
  });

  it('frais encaissés, contrat en brouillon : « Préparation du contrat » en cours, jamais « Signature »', () => {
    const steps = acquisitionSteps(
      reservation({ status: 'reserved', payment_schedule: SCHEDULE }),
      [contract({ status: 'draft' })],
      [call({ settlement: 'settled', settled_amount: '100000.00' })],
    );
    expect(steps[2]).toMatchObject({ label: 'Préparation du contrat', state: 'current' });
    expect(steps[1].caption!.replace(/\s/g, ' ')).toBe('100 000 XOF / 3 000 000 XOF — reste 2 900 000 XOF (frais inclus)');
  });

  it('contrat approuvé : l’étape devient « Signature du contrat (simulée) »', () => {
    expect(acquisitionSteps(reservation({ status: 'reserved' }), [contract()])[2].label).toBe('Signature du contrat (simulée)');
  });

  it('acquisition concrétisée : seul le suivi du chantier reste, en cours', () => {
    expect(states(acquisitionSteps(reservation({ status: 'committed' }), [contract({ status: 'signed_simulated' })])))
      .toEqual(['done', 'done', 'done', 'current']);
  });
});

describe('nextAction — une seule action attendue du client (ticket F-074, audit C02)', () => {
  it('dossier en examen, aucun appel : aucune action du client, et ce qui va se passer', () => {
    expect(nextAction(reservation(), [], [])).toEqual({
      kind: 'wait', next: 'Votre conseiller examine votre dossier, puis vous enverra l’appel des frais de réservation.',
    });
  });

  it('un appel émis et non couvert : payer cet appel', () => {
    const frais = call();
    expect(nextAction(reservation({ validated_at: 'x' }), [frais], [])).toEqual({ kind: 'pay', call: frais });
  });

  it('virement signalé : en attente d’encaissement, jamais une seconde demande de paiement', () => {
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

  it('contrat en préparation : ce n’est pas une action du client (C02)', () => {
    expect(nextAction(reservation({ status: 'reserved' }), [call({ settlement: 'settled', settled_amount: '100000.00' })], []))
      .toEqual({ kind: 'wait', next: 'Votre conseiller prépare votre contrat. Vous serez prévenu pour le signer (signature simulée).' });
  });
});

describe('AcquisitionJourney — rendu du parcours (ticket F-074)', () => {
  it('affiche le bien, les étapes, la prochaine action « payer » avec les instructions, et le suivi financier', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([call()]),
      getMyContracts: vi.fn().mockResolvedValue([]),
    });
    render(withApiClient(api, (
      <AcquisitionJourney reservation={reservation({ validated_at: '2026-09-27T15:00:00Z', payment_schedule: SCHEDULE })} onChanged={() => {}} />
    )));

    const hero = screen.getByRole('region', { name: 'Mon bien' });
    expect(hero).toHaveTextContent('Résidence Démonstration Abidjan');
    expect(hero.textContent!.replace(/\s/g, ' ')).toContain('30 000 000 XOF');
    expect(hero).toHaveTextContent('Constructeur : Promoteur Démonstration');
    expect(within(hero).getByTestId('simulated-mark')).toHaveTextContent('SIMULÉ — SANS VALEUR OPÉRATIONNELLE');
    expect(screen.getByTestId('step-first-payment')).toHaveAttribute('aria-current', 'step');

    const next = await screen.findByTestId('next-action');
    expect(next).toHaveAttribute('data-kind', 'pay');
    expect(next).toHaveTextContent('Régler : Frais de réservation');
    expect(within(next).getByTestId('payment-reference')).toHaveTextContent('KEYA-1A2B3C4D');
    expect(within(next).getByRole('button', { name: 'Signaler mon virement' })).toBeInTheDocument();

    // C04 : repère principal = premier versement ; prix total secondaire.
    const summary = screen.getByRole('region', { name: 'Suivi financier' });
    expect(within(summary).getByTestId('summary-call')).toHaveTextContent('À régler');
    expect(within(summary).getByTestId('settled-total').textContent!.replace(/\s/g, ' ')).toBe('0 XOF');
    expect(within(summary).getByTestId('first-payment-remaining').textContent!.replace(/\s/g, ' '))
      .toBe('Reste 3 000 000 XOF (frais de réservation inclus)');
    expect(summary.textContent!.replace(/\s/g, ' ')).toContain('Prix total du bien (fictif)30 000 000 XOF');

    // C06 : échéancier contractuel fictif, montant et condition de chaque appel.
    const schedule = screen.getByRole('region', { name: 'Échéancier du contrat' });
    expect(within(schedule).getAllByTestId('schedule-row')).toHaveLength(2);
    expect(schedule).toHaveTextContent('Appel émis par le gestionnaire, après acceptation technique du jalon « Fondations ».');
    // C06 (décision du PO) : dates prévisionnelles fictives, libellées comme telles.
    expect(within(schedule).getAllByTestId('schedule-planned')[1]).toHaveTextContent('Date prévisionnelle (fictive) : 26 déc. 2026');
    expect(schedule).toHaveTextContent('non validées juridiquement');
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

describe('AcquisitionJourney — virement signalé (PO-2026-09-28-09)', () => {
  it('aucune action n’est demandée : Finance vérifie le virement au relevé', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([call({
        notice: {
          id: 'n1', status: 'declared', status_label: 'Signalé par le client — non encaissé', amount: '100000.00',
          client_reference: 'VIR-1', paid_on: '2026-09-28', rejection_reason: '',
        },
      })]),
      getMyContracts: vi.fn().mockResolvedValue([]),
    });
    render(withApiClient(api, <AcquisitionJourney reservation={reservation({ validated_at: 'x' })} onChanged={() => {}} />));

    const next = await screen.findByTestId('next-action');
    expect(next).toHaveAttribute('data-kind', 'verifying');
    expect(next).toHaveTextContent('Aucune action de votre part — Finance vérifie votre virement au relevé');
    expect(next).not.toHaveTextContent('Votre prochaine action');
    expect(next).not.toHaveTextContent('Réglez les frais');
  });
});

describe('AcquisitionJourney — suivi du chantier (PO-2026-09-28-04)', () => {
  it('chaque jalon montre son état et l’échelle des niveaux, avec qui, quand, version et périmètre', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([call({ settlement: 'settled', settled_amount: '100000.00' })]),
      getMyContracts: vi.fn().mockResolvedValue([]),
      getMyWorksite: vi.fn().mockResolvedValue([{
        id: 'm1', order: 1, code: 'fondations', label: 'Fondations', cdc_state: 'UNDER_REVIEW', status_label: 'En examen',
        status_hint: '',
        trust_levels: {
          declared: { by: 'Constructeur Démo', role: 'Constructeur', at: '2026-09-27T20:10:00Z', version: 'déclaration n° 1', scope: 'Jalon « Fondations », Lot A1' },
        },
      }]),
    });
    render(withApiClient(api, <AcquisitionJourney reservation={reservation({ status: 'committed' })} onChanged={() => {}} />));

    const item = await screen.findByTestId('worksite-milestone');
    expect(item).toHaveTextContent('1. Fondations');
    expect(item).toHaveTextContent('En examen');
    const declared = within(item).getByTestId('trust-level-declared');
    // Adapté selon PO-2026-09-28-18 : « organisation · rôle », jamais de parenthèses.
    expect(declared).toHaveTextContent('Constructeur Démo · Constructeur');
    expect(declared).toHaveTextContent('27 sept. 2026, 20:10 (GMT, Abidjan)');
    expect(declared).toHaveTextContent('déclaration n° 1');
    expect(within(item).getByTestId('trust-level-validated')).toHaveTextContent('Non atteint');
    expect(item.textContent).not.toMatch(/%/);
  });

  it('PO-2026-09-28-16 : résumé des réserves en langage simple (motif, ouverte/levée, date), sans détail interne', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([call({ settlement: 'settled', settled_amount: '100000.00' })]),
      getMyContracts: vi.fn().mockResolvedValue([]),
      getMyWorksite: vi.fn().mockResolvedValue([{
        id: 'm1', order: 1, code: 'fondations', label: 'Fondations', cdc_state: 'CHANGES_REQUESTED',
        status_label: 'Corrections demandées', status_hint: '', trust_levels: {},
        reserves: [
          { motif: 'Enrobage insuffisant', status: 'ouverte', status_label: 'Ouverte — une correction est attendue du constructeur', date: '2026-09-27T20:10:00Z' },
          { motif: 'Joint de dilatation', status: 'levee', status_label: 'Levée — correction constatée par le contrôleur', date: '2026-09-28T09:00:00Z' },
        ],
      }]),
    });
    render(withApiClient(api, <AcquisitionJourney reservation={reservation({ status: 'committed' })} onChanged={() => {}} />));

    const [open, lifted] = await screen.findAllByTestId('worksite-reserve');
    expect(open).toHaveTextContent('Réserve : Enrobage insuffisant');
    expect(open).toHaveTextContent('Ouverte');
    expect(open).toHaveTextContent('27 sept. 2026, 20:10 (GMT, Abidjan)');
    expect(lifted).toHaveTextContent('Réserve : Joint de dilatation');
    expect(lifted).toHaveTextContent('Levée');
    expect(lifted).toHaveTextContent('28 sept. 2026');
  });

  it('pas de suivi du chantier tant que le bien est seulement bloqué', async () => {
    const api = createMockApiClient({
      getMyPaymentCalls: vi.fn().mockResolvedValue([]), getMyContracts: vi.fn().mockResolvedValue([]),
    });
    render(withApiClient(api, <AcquisitionJourney reservation={reservation()} onChanged={() => {}} />));
    await screen.findByTestId('next-action');
    expect(screen.queryByRole('region', { name: 'Suivi du chantier' })).not.toBeInTheDocument();
  });
});
