import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LotRow, PaginatedResponse } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { AllLotsView } from './AllLotsView';

function makeRow(overrides: Partial<LotRow> = {}): LotRow {
  return {
    id: 'lot-1', name: 'Lot 12', asset_name: 'Résidence Ker', program_id: 'program-1',
    program_name: 'Programme Keur Massar', assigned_organization_id: null,
    assigned_organization_name: null, milestone_count: 8, declared_milestone_count: 1,
    progress_percentage: 5, open_reserve_count: 0, created_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

function makePage(results: LotRow[], overrides: Partial<PaginatedResponse<LotRow>> = {}): PaginatedResponse<LotRow> {
  return { count: results.length, next: null, previous: null, results, ...overrides };
}

describe('AllLotsView — tableau, pas de version simplifiée (critère d\'acceptation)', () => {
  it('affiche les lignes reçues avec leurs colonnes', async () => {
    const api = createMockApiClient({
      getAllLots: async () => makePage([makeRow({ assigned_organization_name: 'Org Constructeur' })]),
    });
    render(withApiClient(api, <AllLotsView />));

    expect(await screen.findByText('Lot 12')).toBeInTheDocument();
    expect(screen.getByText('Résidence Ker')).toBeInTheDocument();
    expect(screen.getByText('Org Constructeur')).toBeInTheDocument();
    expect(screen.getByText('1/8')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
  });

  it('affiche « — » pour un lot sans organisation affectée, pas une cellule vide silencieuse', async () => {
    const api = createMockApiClient({ getAllLots: async () => makePage([makeRow()]) });
    render(withApiClient(api, <AllLotsView />));

    await screen.findByText('Lot 12');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('transmet la recherche, le tri et le filtre au backend (aucun tri/filtre local)', async () => {
    const getAllLots = vi.fn().mockResolvedValue(makePage([makeRow()]));
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView />));

    await screen.findByText('Lot 12');

    fireEvent.change(screen.getByLabelText('Rechercher un lot'), { target: { value: 'Ker' } });
    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'Ker' }),
    ));

    fireEvent.change(screen.getByLabelText('Trier par'), { target: { value: '-progress_percentage' } });
    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ ordering: '-progress_percentage' }),
    ));

    fireEvent.change(screen.getByLabelText('Filtrer par affectation'), { target: { value: 'false' } });
    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ assigned: 'false' }),
    ));
  });

  it('préremplit la recherche depuis initialSearch (lien "Voir dans Tous les lots")', async () => {
    const getAllLots = vi.fn().mockResolvedValue(makePage([makeRow()]));
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView initialSearch="Lot Retard" />));

    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'Lot Retard' }),
    ));
    expect(screen.getByLabelText('Rechercher un lot')).toHaveValue('Lot Retard');
  });
});

describe('AllLotsView — densité réglable (tokens du ticket 007)', () => {
  it('bascule la densité au clic, sans redéfinir de nouveaux styles ad hoc', async () => {
    const api = createMockApiClient({ getAllLots: async () => makePage([makeRow()]) });
    render(withApiClient(api, <AllLotsView />));

    const row = await screen.findByTestId('lot-row');
    const denseButton = screen.getByRole('button', { name: 'Dense' });
    const comfortableButton = screen.getByRole('button', { name: 'Confortable' });

    expect(denseButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(comfortableButton);
    expect(comfortableButton).toHaveAttribute('aria-pressed', 'true');
    expect(denseButton).toHaveAttribute('aria-pressed', 'false');
    // La hauteur de ligne change bien avec la densité (valeur du token, pas
    // une valeur en dur redéfinie ici).
    expect(row).toHaveStyle({ height: '48px' });
  });
});

describe('AllLotsView — pagination', () => {
  it('affiche le total et désactive "Suivant" sur la dernière page', async () => {
    const api = createMockApiClient({
      getAllLots: async () => makePage([makeRow()], { count: 42, next: null, previous: 'http://x/?page=1' }),
    });
    render(withApiClient(api, <AllLotsView />));

    expect(await screen.findByText('42 lot(s)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Précédent' })).not.toBeDisabled();
  });

  it('avance à la page suivante et transmet le bon numéro de page', async () => {
    const getAllLots = vi.fn().mockResolvedValue(
      makePage([makeRow()], { count: 100, next: 'http://x/?page=2' }),
    );
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView />));

    fireEvent.click(await screen.findByRole('button', { name: 'Suivant' }));

    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    ));
  });

  it('affiche un message explicite quand aucun lot ne correspond aux filtres', async () => {
    const api = createMockApiClient({ getAllLots: async () => makePage([]) });
    render(withApiClient(api, <AllLotsView />));

    expect(await screen.findByText('Aucun lot ne correspond à ces critères.')).toBeInTheDocument();
  });
});
