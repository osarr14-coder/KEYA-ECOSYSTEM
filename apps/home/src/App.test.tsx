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
  accepted_milestone_count: 1, milestone_count: 2, milestones: [],
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
    // Adapté selon PO-2026-09-28-14 : « n / N jalons acceptés techniquement », plus de %.
    expect(screen.getByText('1 / 2 jalons acceptés techniquement')).toBeInTheDocument();
    // 3. L'événement récent — adapté selon PO-2026-09-28-04 (ligne datée, plus de badge)
    expect(screen.getByTestId('trust-event')).toHaveTextContent('Niveau atteint : Documenté');
    // 4. Le problème principal — avec le style d'alerte (role="alert" + icône)
    const problem = screen.getByText('Fissure en façade').closest('[data-testid="open-reserve"]');
    expect(problem).not.toBeNull();
    expect(problem!.querySelector('[role="alert"]')).not.toBeNull();
    expect(problem!.querySelector('svg')).not.toBeNull();
    // 5. La prochaine action — désormais visible sans clic supplémentaire
    expect(await screen.findByText('Corriger la fissure signalée')).toBeInTheDocument();
    // Adapté selon PO-2026-09-28-11 : format unique F06.
    expect(screen.getByText(/^Échéance : 1 avr\. 2026/)).toBeInTheDocument();
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

    // Entrée "Mes actions" de la barre latérale désormais active (ticket
    // F-074 : navigation unique), avec la liste complète chargée.
    expect(screen.getByRole('link', { name: /^Mes actions/ })).toHaveAttribute('aria-current', 'page');
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
    fireEvent.click(screen.getByRole('link', { name: /^Mes actions/ }));

    expect(await screen.findByText('Action test à faire')).toBeInTheDocument();
  });
});

describe('App — réutilise AppShell tel quel, aucun module professionnel sans rôle', () => {
  it('ne montre BUILD/CONTROL/FINANCE/NOTARY à aucun moment pour un utilisateur client', async () => {
    renderApp();

    await screen.findByText('Résidence Ker');
    expect(screen.queryByText('BUILD')).not.toBeInTheDocument();
    expect(screen.queryByText('CONTROL')).not.toBeInTheDocument();
    expect(screen.queryByText('FINANCE')).not.toBeInTheDocument();
    expect(screen.queryByText('NOTARY')).not.toBeInTheDocument();
  });
});

describe(
  'App — modules BUILD/CONTROL (ticket F-040) : mapping rôle -> app correct, jamais BUILD '
  + 'pour un inspecteur (qui doit atterrir sur CONTROL, comme au login — voir resolveRedirectApp), '
  + 'et vraie navigation cross-origine avec transfert de session, jamais un chemin relatif mort',
  () => {
    const CONSTRUCTEUR_ME = {
      id: 'user-1', email: 'constructeur@example.com', full_name: 'Constructeur Test',
      memberships: [
        {
          organization_id: 'org-1', organization_name: 'Org Constructeur',
          role_code: 'constructeur', role_label: 'Constructeur',
        },
      ],
    };
    const INSPECTEUR_ME = {
      id: 'user-2', email: 'inspecteur@example.com', full_name: 'Inspecteur Test',
      memberships: [
        {
          organization_id: 'org-1', organization_name: 'Org Inspecteur',
          role_code: 'inspecteur', role_label: 'Inspecteur',
        },
      ],
    };

    beforeEach(() => {
      localStorage.setItem('keya_access_token', 'my-access');
      localStorage.setItem('keya_refresh_token', 'my-refresh');
    });

    it('un constructeur voit BUILD (vers apps/build) mais jamais CONTROL', async () => {
      renderApp({ getMe: async () => CONSTRUCTEUR_ME, getMyLots: async () => [] });
      await screen.findByText(/aucun bien ne vous est encore associé/i);

      expect(screen.getByRole('link', { name: 'BUILD' })).toHaveAttribute(
        'href',
        'http://localhost:5174/#access_token=my-access&refresh_token=my-refresh',
      );
      expect(screen.queryByText('CONTROL')).not.toBeInTheDocument();
    });

    it('un inspecteur voit CONTROL (vers apps/control-pwa) mais jamais BUILD', async () => {
      renderApp({ getMe: async () => INSPECTEUR_ME, getMyLots: async () => [] });
      await screen.findByText(/aucun bien ne vous est encore associé/i);

      expect(screen.getByRole('link', { name: 'CONTROL' })).toHaveAttribute(
        'href',
        'http://localhost:5175/#access_token=my-access&refresh_token=my-refresh',
      );
      expect(screen.queryByText('BUILD')).not.toBeInTheDocument();
    });
  },
);

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

  it("affiche un message explicite quand aucun bien n'est associé (rôle sans parcours d'achat)", async () => {
    // Ticket F-066 — un `client` sans bien atterrit désormais sur le
    // catalogue (voir le test dédié ci-dessous) ; le message générique reste
    // celui des autres rôles.
    renderApp({
      getMe: async () => ({
        ...SINGLE_MEMBERSHIP_ME,
        memberships: [{ ...SINGLE_MEMBERSHIP_ME.memberships[0], role_code: 'constructeur', role_label: 'Constructeur' }],
      }),
      getMyLots: async () => [],
    });

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

describe('App — sponsor sans bien (ticket F-057, programme sur mesure)', () => {
  const SPONSOR_ME = {
    id: 'user-sponsor', email: 'sponsor@example.com', full_name: 'Sponsor Test',
    memberships: [
      { organization_id: 'org-sponsor', organization_name: 'Compte personnel — sponsor@example.com', role_code: 'sponsor', role_label: 'Sponsor' },
    ],
  };

  // Audit UI R1 (R04, PO-2026-09-27-13) : module différé, masqué par défaut ;
  // ces tests exercent son code avec le réglage activé.
  afterEach(() => { vi.unstubAllEnvs(); });

  it('audit R04 : par défaut, aucun écran « Programme sur mesure », même pour un sponsor', async () => {
    renderApp({
      getMe: async () => SPONSOR_ME,
      getMyProgramRequests: async () => [],
    });

    await screen.findByTestId('app-shell');
    expect(screen.queryByRole('link', { name: 'Programme sur mesure' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Soumettre une demande de programme' })).not.toBeInTheDocument();
  });

  it("un sponsor sans bien voit directement l'écran de demande, jamais le message générique", async () => {
    vi.stubEnv('VITE_DEFERRED_MODULES_ENABLED', 'true');
    renderApp({
      getMe: async () => SPONSOR_ME,
      getMyLots: async () => [],
      getMyProgramRequests: async () => [],
    });

    expect(await screen.findByRole('form', { name: 'Soumettre une demande de programme' })).toBeInTheDocument();
    expect(screen.queryByText('Aucun bien ne vous est encore associé.')).not.toBeInTheDocument();
  });

  it('ticket F-066 — un client (pas sponsor) sans bien atterrit sur le catalogue, jamais sur la demande sur mesure', async () => {
    renderApp({ getMyLots: async () => [], getMyReservations: async () => [], getCatalogLots: async () => [] });

    expect(await screen.findByRole('heading', { level: 1, name: 'Mon acquisition' })).toBeInTheDocument();
    expect(screen.queryByText('Aucun bien ne vous est encore associé.')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Soumettre une demande de programme' })).not.toBeInTheDocument();
  });

  it('ticket F-066/F-074 — un client qui possède déjà un bien a une entrée supplémentaire « Mon acquisition »', async () => {
    renderApp({ getMyReservations: async () => [], getCatalogLots: async () => [] });

    fireEvent.click(await screen.findByRole('link', { name: 'Mon acquisition' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Mon acquisition' })).toBeInTheDocument();
  });

  it('un sponsor qui possède déjà un bien voit un onglet supplémentaire « Programme sur mesure »', async () => {
    vi.stubEnv('VITE_DEFERRED_MODULES_ENABLED', 'true');
    renderApp({
      getMe: async () => SPONSOR_ME,
      getMyProgramRequests: async () => [],
    });

    await screen.findByText('Résidence Ker');
    const tab = screen.getByRole('link', { name: 'Programme sur mesure' });
    fireEvent.click(tab);

    expect(await screen.findByRole('form', { name: 'Soumettre une demande de programme' })).toBeInTheDocument();
  });

  it("un client qui possède déjà un bien ne voit pas l'onglet « Programme sur mesure »", async () => {
    renderApp();

    await screen.findByText('Résidence Ker');
    expect(screen.queryByRole('link', { name: 'Programme sur mesure' })).not.toBeInTheDocument();
  });
});

describe('App — compteur de la cloche AppShell (ticket F-060)', () => {
  it('affiche le nombre de tâches en attente, jamais 0 par défaut', async () => {
    renderApp({
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'notification' as const, subject_type: 'programs.programrequest', subject_id: 'req-1',
          program: null, assignee: 'user-1', source: 'program_request_decided', label: 'Notif 1',
          due_date: null, priority: 'normal' as const, status: 'pending' as const,
          created_at: '2026-03-01T00:00:00Z', completed_at: null,
        },
        {
          id: 'task-2', type: 'task' as const, subject_type: 'inspections.reserve', subject_id: 'res-1',
          program: null, assignee: 'user-1', source: 'reserve_opened', label: 'Notif 2',
          due_date: null, priority: 'normal' as const, status: 'pending' as const,
          created_at: '2026-03-01T00:00:00Z', completed_at: null,
        },
      ],
    });

    expect(await screen.findByTestId('task-inbox-count')).toHaveTextContent('2');
  });

  // Adapté selon PO-2026-09-27-20 (DESIGN_SYSTEM §12, V10) : la cloche
  // n'affiche un compteur que s'il y a des actions en attente.
  it('n\'affiche aucun compteur en l\'absence de tâche en attente', async () => {
    const getMyTasks = vi.fn(async () => []);
    renderApp({ getMyTasks });

    await waitFor(() => expect(getMyTasks).toHaveBeenCalled());
    // Adapté selon PO-2026-09-28-59 (P15, P16) : libellé français, « affecter ».
    expect(await screen.findByLabelText('Tâches — 0 en attente')).toBeInTheDocument();
    expect(screen.queryByTestId('task-inbox-count')).not.toBeInTheDocument();
  });
});

describe('App — clic sur la cloche AppShell (ticket F-061)', () => {
  it('bascule sur l\'onglet « Mes actions », jamais une navigation réelle vers /tasks', async () => {
    renderApp();
    await screen.findByText('Résidence Ker');

    // Adapté selon PO-2026-09-28-59 (P15, P16) : libellé français, « affecter ».
    fireEvent.click(screen.getByRole('link', { name: /^Tâches — \d+ en attente$/ }));

    expect(await screen.findByRole('link', { name: /^Mes actions/ })).toHaveAttribute('aria-current', 'page');
    expect(window.location.pathname).toBe('/');
  });
});
