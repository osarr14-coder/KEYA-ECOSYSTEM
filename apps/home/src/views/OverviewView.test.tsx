import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { OverviewView } from './OverviewView';

describe('OverviewView — aucun calcul côté frontend (critère d\'acceptation)', () => {
  it('affiche exactement le pourcentage renvoyé par l\'API, sans le recalculer', async () => {
    // 37 n'est atteignable par aucune formule "ronde" plausible côté
    // frontend (pas 0/25/50/75/100) — si le composant affichait autre chose
    // que 37, ce serait la preuve d'une transformation locale, pas un
    // simple passthrough.
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Almadies, Dakar', program_name: 'Programme Keur Massar',
        progress_percentage: 37, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" />));

    expect(await screen.findByText('37% d\'avancement')).toBeInTheDocument();
  });

  it('affiche le hero du bien tel que reçu (nom, programme, lot, localisation)', async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Almadies, Dakar', program_name: 'Programme Keur Massar',
        progress_percentage: 0, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" />));

    const hero = await screen.findByTestId('hero');
    expect(hero).toHaveTextContent('Résidence Ker');
    expect(hero).toHaveTextContent('Programme Keur Massar');
    expect(hero).toHaveTextContent('Lot 12');
    expect(hero).toHaveTextContent('Almadies, Dakar');
  });

  it('affiche le dernier événement notable via StatusBadge, avec les données reçues', async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 40, milestones: [],
        latest_notable_event: {
          level: 'documente', source: 'evidence_upload', actor: 'constructeur@example.com',
          scope: '', created_at: '2026-03-05T10:30:00Z',
        },
        open_reserve: null,
      }),
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" />));

    expect(await screen.findByText('Documenté')).toBeInTheDocument();
    // Popover fermé par défaut — seul le libellé du badge est visible avant clic.
    expect(screen.queryByText('constructeur@example.com')).not.toBeInTheDocument();
  });

  it("affiche une réserve ouverte comme problème principal", async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 60, milestones: [], latest_notable_event: null,
        open_reserve: { id: 'reserve-1', status: 'ouverte', description: 'Fissure en façade' },
      }),
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" />));

    const problem = await screen.findByTestId('open-reserve');
    expect(problem).toHaveTextContent('Réserve ouverte');
    expect(problem).toHaveTextContent('Fissure en façade');
  });

  it("n'affiche aucun bloc problème quand il n'y a pas de réserve ouverte", async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 60, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" />));

    await screen.findByText("60% d'avancement");
    expect(screen.queryByTestId('open-reserve')).not.toBeInTheDocument();
  });
});
