import { Blob as NodeBlob } from 'node:buffer';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    expect(await screen.findByText('Lot 12')).toBeInTheDocument();
    expect(screen.getByText('Résidence Ker')).toBeInTheDocument();
    expect(screen.getByText('Org Constructeur')).toBeInTheDocument();
    expect(screen.getByText('1/8')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
  });

  it('affiche « — » pour un lot sans organisation affectée, pas une cellule vide silencieuse', async () => {
    const api = createMockApiClient({ getAllLots: async () => makePage([makeRow()]) });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    await screen.findByText('Lot 12');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('transmet la recherche, le tri et le filtre au backend (aucun tri/filtre local)', async () => {
    const getAllLots = vi.fn().mockResolvedValue(makePage([makeRow()]));
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

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
    render(withApiClient(api, <AllLotsView initialSearch="Lot Retard" activeOrganizationId={null} />));

    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'Lot Retard' }),
    ));
    expect(screen.getByLabelText('Rechercher un lot')).toHaveValue('Lot Retard');
  });
});

describe('AllLotsView — densité réglable (tokens du ticket 007)', () => {
  it('bascule la densité au clic, sans redéfinir de nouveaux styles ad hoc', async () => {
    const api = createMockApiClient({ getAllLots: async () => makePage([makeRow()]) });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

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
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    expect(await screen.findByText('42 lot(s)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Précédent' })).not.toBeDisabled();
  });

  it('avance à la page suivante et transmet le bon numéro de page', async () => {
    const getAllLots = vi.fn().mockResolvedValue(
      makePage([makeRow()], { count: 100, next: 'http://x/?page=2' }),
    );
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Suivant' }));

    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    ));
  });

  it('affiche un message explicite quand aucun lot ne correspond aux filtres', async () => {
    const api = createMockApiClient({ getAllLots: async () => makePage([]) });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    expect(await screen.findByText('Aucun lot ne correspond à ces critères.')).toBeInTheDocument();
  });
});

describe('AllLotsView — export CSV (ticket F-032)', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: { mockRestore: () => void };
  let clickedAnchors: HTMLAnchorElement[];

  beforeEach(() => {
    createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;
    clickedAnchors = [];
    // `downloadCsv` retire l'ancre du DOM juste après le clic (synchrone) —
    // capturer l'instance ICI (plutôt que la requêter après coup) est le
    // seul moyen fiable d'inspecter son attribut `download`.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(
      this: HTMLAnchorElement,
    ) {
      clickedAnchors.push(this);
    });
    vi.stubGlobal('Blob', NodeBlob);
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  async function lastDownloadedCsv(): Promise<string> {
    const [blob] = createObjectURL.mock.calls.at(-1) as [Blob];
    const text = new TextDecoder('utf-8').decode(new Uint8Array(await blob.arrayBuffer()));
    return text.slice(1); // retire le BOM UTF-8 pour comparer le contenu CSV
  }

  it(
    'sous le seuil d\'avertissement : exporte directement TOUTES les lignes filtrées/triées '
    + '(pas seulement la page affichée à l\'écran)',
    async () => {
      const getAllLots = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
        if (query.page_size === 100) {
          // Appel(s) d'export : deux pages pour prouver que la pagination
          // de l'écran (25) n'est pas ce qui borne l'export.
          if (query.page === 1) {
            return makePage(
              [makeRow({ id: 'a', name: 'Lot A' })],
              { count: 2, next: 'http://x/?page=2&page_size=100' },
            );
          }
          return makePage([makeRow({ id: 'b', name: 'Lot B' })], { count: 2, next: null });
        }
        // Chargement initial de l'écran (page_size: 25).
        return makePage([makeRow({ id: 'a', name: 'Lot A' })], { count: 2 });
      });
      const api = createMockApiClient({ getAllLots });
      render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

      await screen.findByText('Lot A');
      fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      const csv = await lastDownloadedCsv();
      expect(csv).toContain('Lot A');
      expect(csv).toContain('Lot B');

      expect(getAllLots).toHaveBeenCalledWith(expect.objectContaining({ page: 1, page_size: 100 }));
      expect(getAllLots).toHaveBeenCalledWith(expect.objectContaining({ page: 2, page_size: 100 }));
    },
  );

  it('respecte le filtre et le tri actifs à l\'écran au moment de l\'export', async () => {
    const getAllLots = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
      if (query.page_size === 100) return makePage([makeRow()], { count: 1, next: null });
      return makePage([makeRow()], { count: 1 });
    });
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    await screen.findByText('Lot 12');
    fireEvent.change(screen.getByLabelText('Rechercher un lot'), { target: { value: 'Ker' } });
    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Ker' })));
    fireEvent.change(screen.getByLabelText('Trier par'), { target: { value: '-progress_percentage' } });
    await waitFor(() => expect(getAllLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ ordering: '-progress_percentage' }),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));

    await waitFor(() => expect(getAllLots).toHaveBeenCalledWith(expect.objectContaining({
      q: 'Ker', ordering: '-progress_percentage', page: 1, page_size: 100,
    })));
  });

  it(
    'au-delà du seuil de requêtes : affiche un avertissement AVANT de lancer le moindre '
    + 'appel réseau d\'export, jamais un export silencieux',
    async () => {
      const getAllLots = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
        if (query.page_size === 100) return makePage([makeRow()], { count: 1500, next: null });
        return makePage([makeRow()], { count: 1500 });
      });
      const api = createMockApiClient({ getAllLots });
      render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

      await screen.findByText('Lot 12');
      const callsBeforeExport = getAllLots.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));

      expect(await screen.findByText(/1500 lot\(s\), 15 requêtes nécessaires/)).toBeInTheDocument();
      expect(getAllLots).toHaveBeenCalledTimes(callsBeforeExport);

      fireEvent.click(screen.getByRole('button', { name: 'Continuer l\'export' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    },
  );

  it('"Annuler" referme l\'avertissement sans lancer l\'export', async () => {
    const getAllLots = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
      if (query.page_size === 100) return makePage([makeRow()], { count: 1500, next: null });
      return makePage([makeRow()], { count: 1500 });
    });
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    await screen.findByText('Lot 12');
    fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));
    await screen.findByText(/requêtes nécessaires/);
    const callsAfterWarning = getAllLots.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(screen.queryByText(/requêtes nécessaires/)).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(getAllLots).toHaveBeenCalledTimes(callsAfterWarning);
  });

  it('affiche un état de chargement explicite pendant l\'export, bouton désactivé', async () => {
    let resolveExportPage: ((value: PaginatedResponse<LotRow>) => void) | undefined;
    const getAllLots = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
      if (query.page_size === 100) {
        return new Promise<PaginatedResponse<LotRow>>((resolve) => { resolveExportPage = resolve; });
      }
      return makePage([makeRow()], { count: 1 });
    });
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    await screen.findByText('Lot 12');
    fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));

    const exportingButton = await screen.findByRole('button', { name: 'Export en cours…' });
    expect(exportingButton).toBeDisabled();

    resolveExportPage!(makePage([makeRow()], { count: 1, next: null }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
  });

  it(
    'un échec réseau pendant l\'export affiche une erreur explicite, ne télécharge rien, '
    + 'et reste réessayable (bouton réactivé)',
    async () => {
      const getAllLots = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
        if (query.page_size === 100) throw new Error('network down');
        return makePage([makeRow()], { count: 1 });
      });
      const api = createMockApiClient({ getAllLots });
      render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

      await screen.findByText('Lot 12');
      fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));

      expect(await screen.findByText('Échec de l\'export CSV. Réessayez.')).toBeInTheDocument();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Exporter en CSV' })).not.toBeDisabled();
    },
  );

  it('nomme le fichier téléchargé avec la date du jour (tous-les-lots-YYYY-MM-DD.csv)', async () => {
    // `toFake: ['Date']` seul — piège déjà documenté au ticket F-027 :
    // faker aussi `setTimeout` casserait le polling interne de
    // `waitFor`/`findBy*` (Testing Library), qui s'appuie dessus.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-20T10:00:00Z'));
    try {
      const getAllLots = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
        if (query.page_size === 100) return makePage([makeRow()], { count: 1, next: null });
        return makePage([makeRow()], { count: 1 });
      });
      const api = createMockApiClient({ getAllLots });
      render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

      await screen.findByText('Lot 12');
      fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));

      await waitFor(() => expect(clickedAnchors).toHaveLength(1));
      expect(clickedAnchors[0].download).toBe('tous-les-lots-2026-08-20.csv');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AllLotsView — erreur de chargement générique (ticket F-033, vague 3)', () => {
  it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement sans changer les filtres', async () => {
    const getAllLots = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(makePage([makeRow()]));
    const api = createMockApiClient({ getAllLots });
    render(withApiClient(api, <AllLotsView activeOrganizationId={null} />));

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await screen.findByText('Lot 12');
    expect(getAllLots).toHaveBeenCalledTimes(2);
    // Le même filtre/tri est retransmis, pas réinitialisé par le retry.
    expect(getAllLots).toHaveBeenLastCalledWith(expect.objectContaining({ ordering: 'name' }));
  });
});
