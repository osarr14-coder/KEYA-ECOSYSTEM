import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExceptionsPayload, LotRow, PaginatedResponse } from './api/types';
import { App } from './App';
import { createMockApiClient, withApiClient } from './testUtils';

const EMPTY_EXCEPTIONS: ExceptionsPayload = {
  lots_en_retard: [], controles_a_planifier: [], capacites_manquantes: [],
  reserves_ouvertes: [], documents_manquants: [],
};

function makePage(results: LotRow[]): PaginatedResponse<LotRow> {
  return { count: results.length, next: null, previous: null, results };
}

function renderApp(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getExceptions: async () => EMPTY_EXCEPTIONS,
    getAllLots: async () => makePage([]),
    ...overrides,
  });
  return render(withApiClient(api, <App />));
}

describe('App — critère produit 26.2 : Exceptions par défaut, jamais les KPI', () => {
  it('affiche la vue Exceptions au premier rendu, pas "Tous les lots"', async () => {
    renderApp();

    expect(await screen.findByTestId('no-exceptions')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rechercher un lot')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exceptions' })).toHaveAttribute('aria-current', 'page');
  });

  it('bascule vers "Tous les lots" au clic sur l\'onglet dédié', async () => {
    renderApp();
    await screen.findByTestId('no-exceptions');

    fireEvent.click(screen.getByRole('button', { name: 'Tous les lots' }));

    expect(await screen.findByLabelText('Rechercher un lot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tous les lots' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('App — navigation réelle depuis une exception vers Tous les lots', () => {
  it('"Voir dans Tous les lots" bascule d\'onglet ET filtre sur le lot concerné', async () => {
    const getAllLots = vi.fn().mockResolvedValue(makePage([]));
    renderApp({
      getExceptions: async () => ({
        ...EMPTY_EXCEPTIONS,
        lots_en_retard: [{
          lot_id: 'lot-1', lot_name: 'Lot En Retard', asset_name: 'Résidence', program_name: 'Programme',
          label: 'Aucune activité récente',
        }],
      }),
      getAllLots,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Voir dans Tous les lots' }));

    expect(await screen.findByLabelText('Rechercher un lot')).toHaveValue('Lot En Retard');
    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'Lot En Retard' }),
    ));
  });
});

describe('App — réutilise AppShell tel quel, variante dense', () => {
  it('applique la densité dense (pas confortable, réservée à HOME)', async () => {
    renderApp();
    await screen.findByTestId('no-exceptions');
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-density', 'dense');
  });

  it('ne montre FINANCE/NOTARY à aucun moment pour un rôle constructeur', async () => {
    renderApp();
    await screen.findByTestId('no-exceptions');
    expect(screen.queryByText('FINANCE')).not.toBeInTheDocument();
    expect(screen.queryByText('NOTARY')).not.toBeInTheDocument();
    // BUILD lui-même est visible (module sidebar + fil d'Ariane) : le rôle
    // constructeur y correspond.
    expect(screen.getAllByText('BUILD').length).toBeGreaterThan(0);
  });
});
