import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PilotageIndicators } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { PilotageView } from './PilotageView';

/** Lot 4 — pilotage du gestionnaire (PO-2026-09-28-46, -64 à -66, CDC §9.3). */

function indicators(overrides: Partial<PilotageIndicators['indicators']> = {}): PilotageIndicators {
  return {
    computed_at: '2026-09-28T23:40:00Z',
    indicators: {
      jalons: { label: 'Jalons examinés', unit: 'jalons soumis', numerator: 1, denominator: 1, technically_accepted: 0 },
      entrees: { label: 'Entrées rapprochées', unit: 'encaissements exécutés', numerator: 2, denominator: 2 },
      sorties: {
        label: 'Sorties rapprochées', unit: 'décaissements exécutés', numerator: 0, denominator: 0,
        executed_amount: '0.00', currency: 'XOF',
      },
      reserves: { label: 'Réserves', open: 1, lifted: 0, oldest_open_days: 3 },
      pieces: {
        label: 'Pièces exigées déposées', unit: 'pièces exigées', numerator: 1, denominator: 4,
        note: 'Présence d’une pièce, pas sa conformité.',
      },
      ...overrides,
    },
  };
}

const DOSSIER = { id: 'reservation-1', organization_id: 'org-1' };

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const onNavigate = vi.fn();
  const api = createMockApiClient({
    getPilotageIndicators: vi.fn().mockResolvedValue(indicators()),
    ...overrides,
  });
  render(withApiClient(api, <PilotageView onNavigate={onNavigate} />));
  return { api, onNavigate };
}

describe('PilotageView — indicateurs du CDC §9.3 (lot 4)', () => {
  it('affiche numérateur et dénominateur ; dénominateur nul → « Non applicable », jamais 100 %', async () => {
    renderView();

    expect(await screen.findByTestId('indicator-sorties-value')).toHaveTextContent('Non applicable');
    expect(screen.getByTestId('indicator-sorties')).not.toHaveTextContent('100');
    expect(screen.getByTestId('indicator-entrees')).toHaveTextContent('2 / 2 encaissements exécutés');
    expect(screen.getByTestId('indicator-pieces')).toHaveTextContent('25 %');
    expect(screen.getByTestId('indicator-pieces')).toHaveTextContent('Présence d’une pièce, pas sa conformité.');
    expect(screen.getByTestId('indicator-jalons')).toHaveTextContent('Acceptations techniques en cours : 0');
    expect(screen.getByTestId('indicator-reserves')).toHaveTextContent('La plus ancienne ouverte : 3 j');
    expect(screen.getByTestId('indicator-reserves')).not.toHaveTextContent('%');
  });

  it('un clic ouvre les sources ; la pièce déposée n’est pas dite conforme', async () => {
    const getPilotageSources = vi.fn().mockResolvedValue({
      key: 'pieces',
      sources: [
        {
          program: 'Résidence', lot: 'Lot A1', dossier: DOSSIER, milestone: 'Fondations', code: 'plan_implantation',
          label: 'Plan d’implantation', deposited: true, deposited_at: '2026-09-28T22:00:00Z', examined: null,
        },
        {
          program: 'Résidence', lot: 'Lot A1', dossier: DOSSIER, milestone: 'Fondations', code: 'photo_fouilles',
          label: 'Photo des fouilles', deposited: false, deposited_at: null, examined: null,
        },
      ],
    });
    const { api } = renderView({ getPilotageSources });

    fireEvent.click(await screen.findByTestId('indicator-pieces'));

    const sources = await screen.findByTestId('pilotage-sources');
    expect(api.getPilotageSources).toHaveBeenCalledWith('pieces');
    expect(await within(sources).findByText('Manquante')).toBeInTheDocument();
    expect(sources).toHaveTextContent('Déposée le');
    expect(sources).toHaveTextContent('pas qu’il est conforme');
    expect(sources).not.toHaveTextContent('Conforme');
  });

  it('les sorties ne sortent qu’en total (A3), sans ligne détaillée', async () => {
    const getPilotageSources = vi.fn().mockResolvedValue({
      key: 'sorties',
      sources: {
        executed: 1, reconciled: 0, executed_amount: '1000000.00', reconciled_amount: '0.00', currency: 'XOF',
        detail: 'Détail des décaissements réservé à Finance (Comptes & décaissements).',
      },
    });
    renderView({
      getPilotageSources,
      getPilotageIndicators: vi.fn().mockResolvedValue(indicators({
        sorties: {
          label: 'Sorties rapprochées', unit: 'décaissements exécutés', numerator: 0, denominator: 1,
          executed_amount: '1000000.00', currency: 'XOF',
        },
      })),
    });

    fireEvent.click(await screen.findByTestId('indicator-sorties'));

    expect(await screen.findByTestId('outflow-detail')).toHaveTextContent('réservé à Finance');
    expect(within(screen.getByTestId('pilotage-sources')).queryByRole('table')).not.toBeInTheDocument();
  });

  it('une source mène au dossier concerné', async () => {
    const getPilotageSources = vi.fn().mockResolvedValue({
      key: 'reserves',
      sources: [{
        program: 'Résidence', lot: 'Lot A1', dossier: DOSSIER, milestone: 'Fondations', motif: 'Enrobage insuffisant',
        status: 'ouverte', status_label: 'Ouverte', is_open: true, is_lifted: false, opened_at: '2026-09-25T10:00:00Z',
        opened_by: 'Bureau de contrôle Démonstration · Contrôleur', lifted_at: null, age_days: 3,
      }],
    });
    const { onNavigate } = renderView({ getPilotageSources });

    fireEvent.click(await screen.findByTestId('indicator-reserves'));
    const sources = await screen.findByTestId('pilotage-sources');
    expect(await within(sources).findByText('Enrobage insuffisant')).toBeInTheDocument();
    expect(sources).toHaveTextContent('3 j (ouverte)');
    fireEvent.click(within(sources).getByRole('button', { name: 'Ouvrir le dossier — Lot A1, Fondations' }));

    expect(onNavigate).toHaveBeenCalledWith({ tab: 'reservations', reservationId: 'reservation-1' });
  });

  it('passer des sorties (total) aux jalons (liste) n’affiche jamais les données d’un autre indicateur', async () => {
    const getPilotageSources = vi.fn((key: string) => Promise.resolve(key === 'sorties'
      ? {
        key, sources: {
          executed: 0, reconciled: 0, executed_amount: '0.00', reconciled_amount: '0.00', currency: 'XOF',
          detail: 'Détail des décaissements réservé à Finance (Comptes & décaissements).',
        },
      }
      : {
        key, sources: [{
          program: 'Résidence', lot: 'Lot A1', dossier: DOSSIER, milestone: 'Fondations', cdc_state: 'CHANGES_REQUESTED',
          status_label: 'Corrections demandées', examined: true, technically_accepted: false,
          last_opinion: { outcome: 'avec_reserve', outcome_label: 'Avec réserve', at: '2026-09-28T23:57:14Z', by: 'Bureau · Contrôleur' },
        }],
      }));
    renderView({ getPilotageSources: getPilotageSources as never });

    fireEvent.click(await screen.findByTestId('indicator-sorties'));
    expect(await screen.findByTestId('outflow-detail')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('indicator-jalons'));

    const sources = await screen.findByTestId('pilotage-sources');
    expect(await within(sources).findByText('Corrections demandées')).toBeInTheDocument();
    expect(sources).toHaveTextContent('Avec réserve — Bureau · Contrôleur');
  });

  it('accorde les comptes de réserves (1 ouverte, 2 levées)', async () => {
    renderView({
      getPilotageIndicators: vi.fn().mockResolvedValue(indicators({
        reserves: { label: 'Réserves', open: 1, lifted: 2, oldest_open_days: 0 },
      })),
    });

    expect(await screen.findByTestId('indicator-reserves-ouverte')).toHaveTextContent(/^1\s*ouverte$/);
    expect(screen.getByTestId('indicator-reserves-levées')).toHaveTextContent(/^2\s*levées$/);
  });
});
