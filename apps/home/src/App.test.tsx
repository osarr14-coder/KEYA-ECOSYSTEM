import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { ApiError } from './api/client';
import { createMockApiClient, withApiClient } from './testUtils';
import { App } from './App';

beforeEach(() => {
  // Ticket 019 : l'organisation active persiste en localStorage — jamais
  // laisser une valeur d'un test précédent contaminer le suivant.
  localStorage.clear();
});

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

// Ticket 019 : une seule membership par défaut — le sélecteur d'organisation
// (AppShell) ne doit alors jamais apparaître, voir le describe dédié
// ci-dessous pour le cas à plusieurs organisations.
const SINGLE_MEMBERSHIP_ME = {
  id: 'user-1', email: 'client@example.com', full_name: 'Client Test',
  memberships: [
    { organization_id: 'org-1', organization_name: 'Org Client', role_code: 'client', role_label: 'Client' },
  ],
};

function renderApp(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getMe: async () => SINGLE_MEMBERSHIP_ME,
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
  // rapport de fin de ticket, où le test manuel chronométré avait révélé
  // que "prochaine action" manquait à l'écran initial et que "problème
  // principal" manquait de contraste visuel — les deux corrigés ici).
  it("affiche les 5 éléments (bien, avancement, événement récent, problème principal, prochaine action) dès le premier rendu", async () => {
    renderApp({
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'x',
          program: null, assignee: 'client@example.com', source: 'reserve_opened',
          label: 'Corriger la fissure signalée', due_date: '2026-04-01T00:00:00Z',
          priority: 'high' as const, status: 'pending' as const,
          created_at: '2026-03-06T09:00:00Z', completed_at: null,
        },
      ],
    });

    // 1. Le bien
    expect(await screen.findByText('Résidence Ker')).toBeInTheDocument();
    // 2. L'avancement
    expect(screen.getByText("45% d'avancement")).toBeInTheDocument();
    // 3. L'événement récent (StatusBadge)
    expect(screen.getByText('Documenté')).toBeInTheDocument();
    // 4. Le problème principal — avec le style d'alerte (role="alert" + icône)
    const problem = screen.getByText('Fissure en façade').closest('[data-testid="open-reserve"]');
    expect(problem).not.toBeNull();
    expect(problem!.querySelector('[role="alert"]')).not.toBeNull();
    expect(problem!.querySelector('svg')).not.toBeNull();
    // 5. La prochaine action — désormais visible sans clic supplémentaire
    expect(await screen.findByText('Corriger la fissure signalée')).toBeInTheDocument();
    expect(screen.getByText('Échéance : 01/04/2026')).toBeInTheDocument();
  });

  it("« Voir toutes mes actions » depuis le résumé bascule vers l'onglet Mes actions", async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Voir toutes mes actions' }));

    // Onglet "Mes actions" désormais actif, avec la liste complète chargée.
    expect(screen.getByRole('button', { name: 'Mes actions' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Action test à faire')).toBeInTheDocument();
  });

  it("« Mes actions » reste accessible en un clic depuis l'onglet dédié, indépendamment du résumé", async () => {
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

describe(
  'App — App Switcher multi-rôle (ticket 019) : bascule entre organisations réelles, '
  + 'jamais un rôle codé en dur',
  () => {
    const TWO_MEMBERSHIPS_ME = {
      id: 'user-1', email: 'multi@example.com', full_name: 'Multi Org',
      memberships: [
        { organization_id: 'org-1', organization_name: 'Org Client', role_code: 'client', role_label: 'Client' },
        {
          organization_id: 'org-2', organization_name: 'Org Constructeur',
          role_code: 'constructeur', role_label: 'Constructeur',
        },
      ],
    };

    it("n'affiche aucun sélecteur d'organisation quand l'utilisateur n'a qu'une seule membership", async () => {
      renderApp();

      await screen.findByText('Résidence Ker');
      expect(screen.queryByLabelText('Organisation active')).not.toBeInTheDocument();
    });

    it('affiche un sélecteur listant CHAQUE organisation quand il y en a plusieurs', async () => {
      renderApp({ getMe: async () => TWO_MEMBERSHIPS_ME });

      const select = await screen.findByLabelText('Organisation active');
      const optionLabels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
      expect(optionLabels).toEqual(['Org Client', 'Org Constructeur']);
    });

    it(
      'changer d\'organisation redéclenche un vrai appel réseau (getMyLots), persiste le choix en '
      + 'localStorage, et met à jour les modules visibles selon le RÔLE de la nouvelle organisation',
      async () => {
        // Organisation déjà résolue au chargement (utilisateur de retour) :
        // isole le comportement du SWITCH lui-même d'un éventuel double
        // appel de démarrage à froid (couvert par les tests dédiés
        // ci-dessous), pour ne compter ici que les appels dus au switch.
        localStorage.setItem('keya_active_organization_id', 'org-1');
        const getMyLots = vi.fn().mockResolvedValue(LOTS);
        renderApp({ getMe: async () => TWO_MEMBERSHIPS_ME, getMyLots });

        await screen.findByText('Résidence Ker');
        expect(getMyLots).toHaveBeenCalledTimes(1);
        // Rôle 'client' actif au départ : aucun module professionnel visible.
        expect(screen.queryByText('BUILD')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Organisation active'), { target: { value: 'org-2' } });

        // Un VRAI second appel réseau, pas seulement un changement d'affichage.
        await waitFor(() => expect(getMyLots).toHaveBeenCalledTimes(2));
        expect(localStorage.getItem('keya_active_organization_id')).toBe('org-2');
        // Rôle 'constructeur' de la nouvelle organisation active : BUILD
        // devient visible — preuve que `userRoles` reflète la organisation
        // RÉELLEMENT active, jamais une valeur figée au montage.
        expect(await screen.findAllByText('BUILD')).not.toHaveLength(0);
      },
    );

    it(
      'reprend l\'organisation persistée en localStorage au chargement, sans attendre une '
      + 'interaction de l\'utilisateur',
      async () => {
        localStorage.setItem('keya_active_organization_id', 'org-2');
        renderApp({ getMe: async () => TWO_MEMBERSHIPS_ME });

        // Rôle 'constructeur' (org-2) actif dès le premier rendu.
        expect(await screen.findAllByText('BUILD')).not.toHaveLength(0);
        expect(await screen.findByLabelText('Organisation active')).toHaveValue('org-2');
      },
    );

    it(
      'retombe sur la première membership si la valeur persistée ne correspond à aucune '
      + 'membership réelle (ex. session précédente sur le même navigateur), et la re-persiste',
      async () => {
        localStorage.setItem('keya_active_organization_id', 'org-perimee');
        renderApp({ getMe: async () => TWO_MEMBERSHIPS_ME });

        await waitFor(() => expect(localStorage.getItem('keya_active_organization_id')).toBe('org-1'));
        expect(await screen.findByLabelText('Organisation active')).toHaveValue('org-1');
      },
    );
  },
);

describe('App — détection hors ligne (ticket F-033, vague 2)', () => {
  function setNavigatorOnLine(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { value, writable: true, configurable: true });
  }

  afterEach(() => {
    setNavigatorOnLine(true);
  });

  it('affiche un bandeau "Hors ligne" quand navigator.onLine est false dès le montage', async () => {
    setNavigatorOnLine(false);
    renderApp();

    expect(await screen.findByText('Hors ligne')).toBeInTheDocument();
  });

  it('le bandeau disparaît au retour en ligne (événement "online")', async () => {
    setNavigatorOnLine(false);
    renderApp();
    await screen.findByText('Hors ligne');

    act(() => {
      setNavigatorOnLine(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByText('Hors ligne')).not.toBeInTheDocument();
  });

  it('aucun bandeau n\'apparaît quand la connexion est active', async () => {
    renderApp();
    await screen.findByText('Résidence Ker');

    expect(screen.queryByText('Hors ligne')).not.toBeInTheDocument();
  });
});

describe('App — erreur de chargement du profil (ticket F-033, vague 3)', () => {
  it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement de /me', async () => {
    const getMe = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(SINGLE_MEMBERSHIP_ME);
    renderApp({ getMe });

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await screen.findByText('Résidence Ker');
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it(
    'un 403 sur /me affiche "Accès refusé" (jamais retentable), distinct du message '
    + 'générique — ticket F-033 (vague 4)',
    async () => {
      const getMe = vi.fn().mockRejectedValue(new ApiError(403, 'Permission refusée'));
      renderApp({ getMe });

      expect(await screen.findByText('Accès refusé')).toBeInTheDocument();
      expect(screen.queryByText('Impossible de charger votre profil.')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
    },
  );
});
