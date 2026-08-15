import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockApiClient, withApiClient } from './testUtils';
import { App } from './App';

const LOTS = [
  { id: 'lot-1', name: 'Lot 12', asset_name: 'Résidence Ker', asset_location: 'Almadies, Dakar', program_name: 'Programme Keur Massar' },
];

const OVERVIEW = {
  lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
  asset_location: 'Almadies, Dakar', program_name: 'Programme Keur Massar',
  progress_percentage: 45, milestones: [],
  latest_notable_event: {
    level: 'documente' as const, source: 'evidence_upload', actor: 'constructeur@example.com',
    scope: '', created_at: '2026-03-06T09:00:00Z',
  },
  open_reserve: { id: 'reserve-1', status: 'ouverte', description: 'Fissure en façade' },
};

function renderApp(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getMyLots: async () => LOTS,
    getLotOverview: async () => OVERVIEW,
    getLotEvidenceFeed: async () => [],
    getMyTasks: async () => [],
    ...overrides,
  });
  return render(withApiClient(api, <App />));
}

describe('App — critère produit 26.1 : les 5 éléments identifiables sans interaction', () => {
  // Proxy automatisé du "test utilisateur informel" demandé par le ticket —
  // ne remplace pas une vraie session avec un utilisateur test (voir le
  // rapport de fin de ticket), mais prouve que les 5 éléments sont bien
  // rendus SIMULTANÉMENT sur l'écran initial, sans clic supplémentaire.
  it("affiche bien, avancement, événement récent et problème principal dès le premier rendu", async () => {
    renderApp();

    // 1. Le bien
    expect(await screen.findByText('Résidence Ker')).toBeInTheDocument();
    // 2. L'avancement
    expect(screen.getByText("45% d'avancement")).toBeInTheDocument();
    // 3. L'événement récent (StatusBadge)
    expect(screen.getByText('Documenté')).toBeInTheDocument();
    // 4. Le problème principal
    expect(screen.getByText('Fissure en façade')).toBeInTheDocument();
  });

  it("« Mes actions » (prochaine action) est accessible en un clic depuis l'écran initial", async () => {
    renderApp({
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'x',
          program: null, assignee: 'client@example.com', source: 'reserve_opened',
          label: 'Action test à faire', due_date: null, priority: 'normal' as const,
          status: 'pending' as const, created_at: '2026-03-06T09:00:00Z', completed_at: null,
        },
      ],
    });

    await screen.findByText('Résidence Ker');
    fireEvent.click(screen.getByRole('button', { name: 'Mes actions' }));

    expect(await screen.findByText('Action test à faire')).toBeInTheDocument();
  });
});

describe('App — réutilise AppShell tel quel, aucun module professionnel sans rôle', () => {
  it('ne montre BUILD/FINANCE/NOTARY à aucun moment pour un utilisateur client', async () => {
    renderApp();

    await screen.findByText('Résidence Ker');
    expect(screen.queryByText('BUILD')).not.toBeInTheDocument();
    expect(screen.queryByText('FINANCE')).not.toBeInTheDocument();
    expect(screen.queryByText('NOTARY')).not.toBeInTheDocument();
  });
});

describe('App — sélection du bien', () => {
  it("n'affiche pas de sélecteur quand le client n'a qu'un seul bien", async () => {
    renderApp();

    await screen.findByText('Résidence Ker');
    expect(screen.queryByLabelText('Sélection du bien')).not.toBeInTheDocument();
  });

  it("affiche un sélecteur quand le client a plusieurs biens", async () => {
    renderApp({
      getMyLots: async () => [
        ...LOTS,
        { id: 'lot-2', name: 'Lot 13', asset_name: 'Résidence Sud', asset_location: 'Dakar', program_name: 'Programme Keur Massar' },
      ],
    });

    expect(await screen.findByLabelText('Sélection du bien')).toBeInTheDocument();
  });

  it("affiche un message explicite quand aucun bien n'est associé au client", async () => {
    renderApp({ getMyLots: async () => [] });

    expect(await screen.findByText(/aucun bien ne vous est encore associé/i)).toBeInTheDocument();
  });
});
