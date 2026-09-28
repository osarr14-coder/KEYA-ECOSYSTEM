import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './api/client';
import type { BackofficeUserDetail, Me } from './api/types';
import { App } from './App';
import { createMockApiClient, withApiClient } from './testUtils';

beforeEach(() => {
  // Ticket 021 : un token en localStorage bascule App vers le back-office —
  // jamais laisser un test précédent en contaminer un autre.
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  // Ticket F-031 : l'onglet actif est désormais dérivé du pathname — jamais
  // laisser un test qui navigue (ci-dessous) contaminer le pathname d'un
  // test suivant dans ce même fichier (jsdom partage `window` par fichier).
  window.history.replaceState(null, '', '/');
});

/** Ticket F-079 — `/` est désormais la page d'accueil publique : les tests
 * du formulaire de connexion l'ouvrent à son adresse, `/connexion`. */
function renderApp(overrides: Parameters<typeof createMockApiClient>[0] = {}, redirect = vi.fn(), path = '/connexion') {
  window.history.replaceState(null, '', path);
  const api = createMockApiClient({
    getMyInboxTasks: async () => [],
    getPublicOffer: async () => [],
    getPublicWorksites: async () => [],
    ...overrides,
  });
  render(withApiClient(api, <App redirect={redirect} />));
  return { api, redirect };
}

async function fillAndSubmit(email = 'a@example.com', password = 'secret') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /se connecter/i }));
}

const ME_CONSTRUCTEUR: Me = {
  id: 'user-1', email: 'a@example.com', full_name: 'A',
  memberships: [
    { organization_id: 'org-1', organization_name: 'Org', role_code: 'constructeur', role_label: 'Constructeur' },
  ],
};

describe('App — formulaire de connexion (ticket 020)', () => {
  it('affiche les champs email, mot de passe, et le bouton de connexion', () => {
    renderApp();

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Mot de passe')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
  });

  it('transmet exactement email et mot de passe saisis à login()', async () => {
    const login = vi.fn().mockResolvedValue({ access: 'tok', refresh: 'ref' });
    const getMe = vi.fn().mockResolvedValue(ME_CONSTRUCTEUR);
    renderApp({ login, getMe });

    await fillAndSubmit('inspecteur@example.com', 'MonMotDePasse');

    await waitFor(() => expect(login).toHaveBeenCalledWith('inspecteur@example.com', 'MonMotDePasse'));
  });
});

describe('App — connexion réussie : redirection selon le rôle réel (ticket 019/020)', () => {
  it('un rôle constructeur redirige vers BUILD, avec les jetons en fragment', async () => {
    const login = vi.fn().mockResolvedValue({ access: 'access-tok', refresh: 'refresh-tok' });
    const getMe = vi.fn().mockResolvedValue(ME_CONSTRUCTEUR);
    const { redirect } = renderApp({ login, getMe });

    await fillAndSubmit();

    await waitFor(() => expect(redirect).toHaveBeenCalledWith(
      'http://localhost:5174/#access_token=access-tok&refresh_token=refresh-tok',
    ));
  });

  it('un rôle inspecteur redirige vers CONTROL', async () => {
    const login = vi.fn().mockResolvedValue({ access: 'tok', refresh: 'ref' });
    const getMe = vi.fn().mockResolvedValue({
      ...ME_CONSTRUCTEUR,
      memberships: [{ ...ME_CONSTRUCTEUR.memberships[0], role_code: 'inspecteur' }],
    });
    const { redirect } = renderApp({ login, getMe });

    await fillAndSubmit();

    await waitFor(() => expect(redirect).toHaveBeenCalledWith(expect.stringContaining('http://localhost:5175/#')));
  });

  it('un rôle client (ou tout rôle sans app dédiée) redirige vers HOME', async () => {
    const login = vi.fn().mockResolvedValue({ access: 'tok', refresh: 'ref' });
    const getMe = vi.fn().mockResolvedValue({
      ...ME_CONSTRUCTEUR,
      memberships: [{ ...ME_CONSTRUCTEUR.memberships[0], role_code: 'client' }],
    });
    const { redirect } = renderApp({ login, getMe });

    await fillAndSubmit();

    await waitFor(() => expect(redirect).toHaveBeenCalledWith(expect.stringContaining('http://localhost:5173/#')));
  });

  it(
    'un rôle admin_keyimmo redirige vers apps/web ELLE-MÊME (ticket 021, back-office) — '
    + 'plus vers HOME comme avant cette évolution volontaire du mapping',
    async () => {
      const login = vi.fn().mockResolvedValue({ access: 'access-tok', refresh: 'refresh-tok' });
      const getMe = vi.fn().mockResolvedValue({
        ...ME_CONSTRUCTEUR,
        memberships: [{ ...ME_CONSTRUCTEUR.memberships[0], role_code: 'admin_keyimmo' }],
      });
      const { redirect } = renderApp({ login, getMe });

      await fillAndSubmit();

      await waitFor(() => expect(redirect).toHaveBeenCalledWith(
        'http://localhost:5176/#access_token=access-tok&refresh_token=refresh-tok',
      ));
    },
  );
});

describe(
  'App — gestion des erreurs : identifiants invalides et compte désactivé sont '
  + 'INDISTINGUABLES côté backend (vérifié empiriquement, ticket 020), jamais un message inventé',
  () => {
    it('un 401 affiche "Identifiants invalides.", jamais un message différencié inexistant', async () => {
      const login = vi.fn().mockRejectedValue(new ApiError(401, 'No active account found with the given credentials'));
      const { redirect } = renderApp({ login });

      await fillAndSubmit();

      expect(await screen.findByText('Identifiants invalides.')).toBeInTheDocument();
      expect(redirect).not.toHaveBeenCalled();
    });

    it('le formulaire redevient soumettable après une erreur (pas bloqué indéfiniment)', async () => {
      const login = vi.fn().mockRejectedValue(new ApiError(401, 'No active account found with the given credentials'));
      renderApp({ login });

      await fillAndSubmit();
      await screen.findByText('Identifiants invalides.');

      expect(screen.getByRole('button', { name: 'Se connecter' })).not.toBeDisabled();
    });

    it('une erreur autre qu\'un 401 (réseau, 500...) affiche un message générique distinct', async () => {
      const login = vi.fn().mockRejectedValue(new Error('network down'));
      renderApp({ login });

      await fillAndSubmit();

      expect(await screen.findByText('Une erreur est survenue. Réessayez.')).toBeInTheDocument();
    });
  },
);

describe(
  'App — session déjà active (ticket 021) : un token en localStorage bascule vers le '
  + 'back-office, jamais le formulaire de connexion',
  () => {
    const ADMIN_DETAIL: BackofficeUserDetail = {
      user: { id: 'target-1', email: 'cible@example.com', full_name: 'Cible', is_active: true },
      memberships: [{ organization_id: 'org-1', organization_name: 'Org', role: 'constructeur' }],
    };

    function renderAuthenticated(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
      localStorage.setItem('keya_access_token', 'stored-admin-token');
      const api = createMockApiClient({ getMyInboxTasks: async () => [], ...overrides });
      render(withApiClient(api, <App />));
      return { api };
    }

    it('un token présent affiche le back-office (AppShell dense) plutôt que le formulaire de connexion', async () => {
      const getMe = vi.fn().mockResolvedValue({
        id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
        memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
      });
      renderAuthenticated({ getMe });

      expect(await screen.findByTestId('app-shell')).toHaveAttribute('data-density', 'dense');
      expect(screen.queryByLabelText('Connexion')).not.toBeInTheDocument();
      // Audit UI R1 (R02) : l'administrateur n'a pas d'écran métier (« À faire »
      // relève du gestionnaire et de Finance) ; il arrive sur Utilisateurs.
      expect(await screen.findByLabelText('Rechercher un utilisateur par email')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'À faire' })).not.toBeInTheDocument();
      // Ticket F-070 — déconnexion volontaire dans la barre du haut.
      expect(screen.getByRole('button', { name: /Se déconnecter/ })).toBeInTheDocument();
    });

    it(
      'un utilisateur sans membership admin_keyimmo (aucune, pas seulement pas en premier) voit un '
      + 'message "Accès refusé", jamais le back-office',
      async () => {
        const getMe = vi.fn().mockResolvedValue({
          id: 'user-1', email: 'constructeur@example.com', full_name: 'Constructeur',
          memberships: [{ organization_id: 'org-1', organization_name: 'Org', role_code: 'constructeur', role_label: 'Constructeur' }],
        });
        renderAuthenticated({ getMe });

        expect(await screen.findByText('Accès refusé')).toBeInTheDocument();
        expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
        // Ticket F-070 — jamais une impasse : on peut changer de compte.
        expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
      },
    );

    it(
      'admin_keyimmo détecté même si ce n\'est PAS la première membership (capacité '
      + 'transverse, voir auth/adminAccess.ts)',
      async () => {
        const getMe = vi.fn().mockResolvedValue({
          id: 'user-1', email: 'multi@example.com', full_name: 'Multi',
          memberships: [
            { organization_id: 'org-1', organization_name: 'Org Client', role_code: 'client', role_label: 'Client' },
            { organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' },
          ],
        });
        renderAuthenticated({ getMe });

        expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
      },
    );

    it('un échec de /me affiche une erreur, jamais un back-office vide silencieux', async () => {
      const getMe = vi.fn().mockRejectedValue(new Error('network down'));
      renderAuthenticated({ getMe });

      expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger votre profil.');
    });

    it(
      'un 403 sur /me affiche "Accès refusé" (jamais retentable), distinct du message '
      + 'générique — ticket F-033 (vague 4)',
      async () => {
        const getMe = vi.fn().mockRejectedValue(new ApiError(403, 'Permission refusée'));
        renderAuthenticated({ getMe });

        expect(await screen.findByText('Accès refusé')).toBeInTheDocument();
        expect(screen.queryByText('Impossible de charger votre profil.')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
      },
    );

    it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement de /me (ticket F-033)', async () => {
      const getMe = vi.fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({
          id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
          memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
        });
      renderAuthenticated({ getMe });

      await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

      expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
      expect(getMe).toHaveBeenCalledTimes(2);
    });

    it('recherche puis affichage du profil d\'un utilisateur cible (organisation/rôle) fonctionne de bout en bout', async () => {
      const getMe = vi.fn().mockResolvedValue({
        id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
        memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
      });
      const searchUsers = vi.fn().mockResolvedValue([
        { id: 'target-1', email: 'cible@example.com', full_name: 'Cible', is_active: true },
      ]);
      const getUserDetail = vi.fn().mockResolvedValue(ADMIN_DETAIL);
      renderAuthenticated({ getMe, searchUsers, getUserDetail });

      fireEvent.click(await screen.findByRole('link', { name: 'Utilisateurs' }));
      fireEvent.change(await screen.findByLabelText('Rechercher un utilisateur par email'), {
        target: { value: 'cible' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));

      fireEvent.click(await screen.findByRole('button', { name: /cible@example.com/ }));

      expect(await screen.findByText('Org — constructeur')).toBeInTheDocument();
      expect(searchUsers).toHaveBeenCalledWith('cible');
      expect(getUserDetail).toHaveBeenCalledWith('target-1');
    });

    it(
      'ticket 027 : un second onglet "Devis / Appels d\'offres" bascule vers l\'écran devis, '
      + 'jamais affiché par défaut',
      async () => {
        // Audit UI R1 (R04) : module différé, masqué par défaut ; ce test
        // exerce son code avec le réglage activé.
        vi.stubEnv('VITE_DEFERRED_MODULES_ENABLED', 'true');
        const getMe = vi.fn().mockResolvedValue({
          id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
          memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
        });
        renderAuthenticated({ getMe });

        await screen.findByTestId('app-shell');
        // Audit UI R1 (R02) : écran d'arrivée de l'administrateur = Utilisateurs.
        expect(screen.getByRole('link', { name: 'Utilisateurs' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByLabelText('Rechercher un lot (nom)')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('link', { name: "Devis / Appels d'offres" }));

        expect(await screen.findByLabelText('Rechercher un lot (nom)')).toBeInTheDocument();
      },
    );
  },
);

describe(
  'App — navigation par URL des écrans admin (ticket F-031)',
  () => {
    function renderAuthenticated(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
      localStorage.setItem('keya_access_token', 'stored-admin-token');
      const api = createMockApiClient({ getMyInboxTasks: async () => [], ...overrides });
      render(withApiClient(api, <App />));
      return { api };
    }

    const getMeAdmin = () => vi.fn().mockResolvedValue({
      id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
      memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
    });
    // Audit UI R1 (R02) : les écrans métier sont ceux du gestionnaire.
    const getMeAdv = () => vi.fn().mockResolvedValue({
      id: 'adv-1', email: 'adv@example.com', full_name: 'ADV',
      memberships: [{
        organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'gestionnaire_adv', role_label: 'Gestionnaire ADV',
      }],
    });

    it('charger directement /tarifs affiche l\'écran Tarifs actif, jamais « À faire » par défaut', async () => {
      // Audit UI R1 (R04) : module différé, masqué par défaut ; ce test
      // exerce son code avec le réglage activé.
      vi.stubEnv('VITE_DEFERRED_MODULES_ENABLED', 'true');
      window.history.replaceState(null, '', '/tarifs');
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      expect(screen.getByRole('link', { name: 'Tarifs' })).toHaveAttribute('aria-current', 'page');
      expect(screen.queryByRole('heading', { name: 'Vos priorités du jour' })).not.toBeInTheDocument();
    });

    it('changer d\'écran via la barre latérale met à jour l\'URL (pushState), sans recharger la page (F-075)', async () => {
      // Audit UI R1 (R04) : module différé, masqué par défaut ; ce test
      // exerce son code avec le réglage activé.
      vi.stubEnv('VITE_DEFERRED_MODULES_ENABLED', 'true');
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      // `fireEvent.click` renvoie false : la navigation native du lien est annulée.
      expect(fireEvent.click(screen.getByRole('link', { name: "Devis / Appels d'offres" }))).toBe(false);

      await screen.findByLabelText('Rechercher un lot (nom)');
      expect(window.location.pathname).toBe('/devis');
    });

    it('le bouton retour du navigateur restaure l\'onglet précédent', async () => {
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      fireEvent.click(screen.getByRole('link', { name: 'Paliers (Country Pack, démo)' }));
      await screen.findByRole('heading', { name: /Country Pack.*non validé juridiquement/ });

      act(() => {
        window.history.replaceState(null, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      // Audit UI R1 (R02) : `/` ramène l'administrateur à son premier écran.
      expect(await screen.findByRole('link', { name: 'Utilisateurs' })).toHaveAttribute('aria-current', 'page');
    });

    it('un chemin admin inconnu retombe sur « À faire » et corrige l\'URL affichée', async () => {
      window.history.replaceState(null, '', '/ecran-qui-n-existe-pas');
      renderAuthenticated({ getMe: getMeAdv() });

      await screen.findByTestId('app-shell');
      expect(screen.getByRole('link', { name: 'À faire' })).toHaveAttribute('aria-current', 'page');
      expect(window.location.pathname).toBe('/');
    });

    // Ticket F-049 — nouvel onglet "Programmes" (création Program/Asset/Lot).
    it('changer d\'onglet vers Programmes affiche ProgramsView et met à jour l\'URL', async () => {
      renderAuthenticated({ getMe: getMeAdv() });

      await screen.findByTestId('app-shell');
      fireEvent.click(screen.getByRole('link', { name: 'Programmes' }));

      await screen.findByRole('heading', { name: 'Programmes' });
      expect(window.location.pathname).toBe('/programmes');
    });

    // Ticket F-058 — pendant admin de ProgramRequestView.tsx (apps/home).
    it('changer d\'onglet vers Demandes de programme affiche ProgramRequestsView et met à jour l\'URL', async () => {
      // Audit UI R1 (R04) : module différé, masqué par défaut ; ce test
      // exerce son code avec le réglage activé.
      vi.stubEnv('VITE_DEFERRED_MODULES_ENABLED', 'true');
      renderAuthenticated({ getMe: getMeAdv() });

      await screen.findByTestId('app-shell');
      fireEvent.click(screen.getByRole('link', { name: 'Demandes de programme' }));

      await screen.findByRole('heading', { name: 'Demandes de programme' });
      expect(window.location.pathname).toBe('/demandes-programme');
    });

    // Ticket F-051/F-075 — barre latérale regroupée par métier.
    it('la barre latérale du gestionnaire regroupe les écrans métier, « À faire » en tête (F-075, R02)', async () => {
      renderAuthenticated({ getMe: getMeAdv() });

      await screen.findByTestId('app-shell');
      const sidebar = screen.getByRole('complementary', { name: 'Navigation des modules' });
      const entries = Array.from(sidebar.querySelectorAll('li')).map((item) => item.textContent);
      expect(entries).toEqual([
        'À faire',
        // PO-2026-09-27-16 : comptes et virements réservés à Finance ;
        // R04 : « Demandes de programme » masquée (module différé).
        'Ventes', 'Dossiers clients', 'Lots — prix & statut',
        'Chantier', 'Contrôles à affecter',
        'Programmes', 'Programmes',
      ]);
    });

    it('audit R04 : les modules différés réapparaissent seulement si le réglage est activé', async () => {
      vi.stubEnv('VITE_DEFERRED_MODULES_ENABLED', 'true');
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      expect(screen.getByRole('link', { name: "Devis / Appels d'offres" })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Tarifs' })).toBeInTheDocument();
    });

    it('audit R02 : la barre latérale de l’administrateur ne contient aucun écran métier', async () => {
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      const sidebar = screen.getByRole('complementary', { name: 'Navigation des modules' });
      const entries = Array.from(sidebar.querySelectorAll('li')).map((item) => item.textContent);
      expect(entries).toEqual([
        // R04 : Devis / Appels d'offres et Tarifs masqués ; J06 : libellé des paliers.
        'Administration', 'Utilisateurs', 'Journal', 'Paliers (Country Pack, démo)',
      ]);
    });
  },
);

describe('App — état de chargement pendant la soumission', () => {
  it('désactive le bouton et affiche un libellé de progression pendant la requête', async () => {
    let resolveLogin: ((value: { access: string; refresh: string }) => void) | undefined;
    const login = vi.fn(() => new Promise<{ access: string; refresh: string }>((resolve) => {
      resolveLogin = resolve;
    }));
    const getMe = vi.fn().mockResolvedValue(ME_CONSTRUCTEUR);
    renderApp({ login, getMe });

    await fillAndSubmit();

    expect(await screen.findByRole('button', { name: 'Connexion…' })).toBeDisabled();

    resolveLogin!({ access: 'tok', refresh: 'ref' });
  });
});

describe('App — détection hors ligne (ticket F-033, vague 2)', () => {
  function setNavigatorOnLine(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { value, writable: true, configurable: true });
  }

  afterEach(() => {
    setNavigatorOnLine(true);
  });

  it('affiche un bandeau "Hors ligne" sur l\'écran de connexion (pas encore authentifié)', async () => {
    setNavigatorOnLine(false);
    renderApp();

    expect(await screen.findByText('Hors ligne')).toBeInTheDocument();
    expect(screen.getByLabelText('Connexion')).toBeInTheDocument();
  });

  it('affiche un bandeau "Hors ligne" une fois authentifié aussi', async () => {
    setNavigatorOnLine(false);
    localStorage.setItem('keya_access_token', 'stored-admin-token');
    const api = createMockApiClient({
      getMe: vi.fn().mockResolvedValue({
        id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
        memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
      }),
      getMyInboxTasks: async () => [],
    });
    render(withApiClient(api, <App />));

    expect(await screen.findByText('Hors ligne')).toBeInTheDocument();
    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
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

  it('aucun bandeau n\'apparaît quand la connexion est active', () => {
    renderApp();

    expect(screen.queryByText('Hors ligne')).not.toBeInTheDocument();
  });
});

describe('App — compteur de la cloche AppShell (ticket F-060)', () => {
  function renderAuthenticated(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
    localStorage.setItem('keya_access_token', 'stored-admin-token');
    const api = createMockApiClient({
      getMe: vi.fn().mockResolvedValue({
        id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
        memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
      }),
      ...overrides,
    });
    render(withApiClient(api, <App />));
    return { api };
  }

  it('affiche le nombre de tâches en attente, jamais 0 par défaut', async () => {
    renderAuthenticated({
      getMyInboxTasks: async () => [
        {
          id: 'task-1', organization: 'org-target', type: 'alert' as const, subject_type: 'procurement.devis', subject_id: 'devis-1',
          program: null, assignee: 'admin-1', source: 'devis_ajustement_refuse', label: 'Ajustement refusé',
          due_date: null, priority: 'high' as const, status: 'pending' as const,
          created_at: '2026-03-01T00:00:00Z', completed_at: null,
        },
      ],
    });

    expect(await screen.findByTestId('task-inbox-count')).toHaveTextContent('1');
  });

  // Adapté selon PO-2026-09-27-20 (DESIGN_SYSTEM §12, V10) : la cloche
  // n'affiche un compteur que s'il y a des actions en attente.
  it('n\'affiche aucun compteur en l\'absence de tâche en attente', async () => {
    const getMyInboxTasks = vi.fn(async () => []);
    renderAuthenticated({ getMyInboxTasks });

    await waitFor(() => expect(getMyInboxTasks).toHaveBeenCalled());
    // Adapté selon PO-2026-09-28-59 (P15, P16) : libellé français, « affecter ».
    expect(await screen.findByLabelText('Tâches — 0 en attente')).toBeInTheDocument();
    expect(screen.queryByTestId('task-inbox-count')).not.toBeInTheDocument();
  });
});

describe('App — clic sur la cloche AppShell (ticket F-061)', () => {
  it('ouvre « À faire » et met à jour l\'URL, jamais un rechargement complet (F-075)', async () => {
    // Audit UI R1 (R02) : « À faire » est un écran du gestionnaire.
    localStorage.setItem('keya_access_token', 'stored-adv-token');
    const api = createMockApiClient({
      getMe: vi.fn().mockResolvedValue({
        id: 'adv-1', email: 'adv@example.com', full_name: 'ADV',
        memberships: [{
          organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'gestionnaire_adv', role_label: 'Gestionnaire ADV',
        }],
      }),
      getMyInboxTasks: async () => [],
    });
    render(withApiClient(api, <App />));
    await screen.findByTestId('app-shell');
    fireEvent.click(screen.getByRole('link', { name: 'Programmes' }));
    expect(window.location.pathname).toBe('/programmes');

    // Adapté selon PO-2026-09-28-59 (P15, P16) : libellé français, « affecter ».
    fireEvent.click(screen.getByRole('link', { name: /^Tâches — \d+ en attente$/ }));

    expect(await screen.findByRole('heading', { name: 'Vos priorités du jour' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});

describe('App — accès du gestionnaire ADV, équipe KEYIMMO (ticket F-065)', () => {
  const ME_ADV: Me = {
    id: 'adv-1', email: 'adv@example.com', full_name: 'ADV',
    memberships: [
      { organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'gestionnaire_adv', role_label: 'Gestionnaire ADV' },
    ],
  };

  function renderAsAdv(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
    localStorage.setItem('keya_access_token', 'stored-adv-token');
    const getMyInboxTasks = vi.fn().mockResolvedValue([]);
    const api = createMockApiClient({ getMe: vi.fn().mockResolvedValue(ME_ADV), getMyInboxTasks, ...overrides });
    render(withApiClient(api, <App />));
    return { api, getMyInboxTasks };
  }

  it('entre dans apps/web et ne voit que À faire, les ventes, les comptes et les programmes', async () => {
    renderAsAdv();

    await screen.findByTestId('app-shell');
    const sidebar = screen.getByRole('complementary', { name: 'Navigation des modules' });
    const labels = Array.from(sidebar.querySelectorAll('a')).map((link) => link.textContent);
    expect(labels).toEqual([
      // Audit UI R1 (R02) : l'affectation des contrôles passe au gestionnaire.
      // PO-2026-09-27-16 et R03 : comptes et virements à Finance ; R04 :
      // « Demandes de programme » masquée.
      'À faire', 'Dossiers clients', 'Lots — prix & statut',
      'Contrôles à affecter', 'Programmes',
    ]);
    expect(screen.queryByText('Accès refusé')).not.toBeInTheDocument();
  });

  it('arrive sur « À faire », jamais sur un écran admin', async () => {
    renderAsAdv();

    expect(await screen.findByRole('heading', { name: 'Vos priorités du jour' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Rechercher un utilisateur par email')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('un lien direct vers un écran admin (/tarifs) retombe sur « À faire »', async () => {
    window.history.replaceState(null, '', '/tarifs');
    renderAsAdv();

    expect(await screen.findByRole('heading', { name: 'Vos priorités du jour' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('ticket F-071 — cloche visible : boîte personnelle transverse (réservations à valider, paiements reçus)', async () => {
    const { getMyInboxTasks } = renderAsAdv();

    await screen.findByTestId('app-shell');
    // Adapté selon PO-2026-09-28-59 (P15, P16) : libellé français, « affecter ».
    expect(screen.getByRole('link', { name: /^Tâches — \d+ en attente$/ })).toBeInTheDocument();
    expect(getMyInboxTasks).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('une connexion ADV redirige vers apps/web', async () => {
    const login = vi.fn().mockResolvedValue({ access: 'tok', refresh: 'ref' });
    const { redirect } = renderApp({ login, getMe: vi.fn().mockResolvedValue(ME_ADV) });

    await fillAndSubmit();

    await waitFor(() => expect(redirect).toHaveBeenCalledWith(expect.stringContaining('localhost:5176')));
  });
});

describe('App — accès Finance, équipe KEYIMMO (ticket F-068)', () => {
  const ME_FINANCE: Me = {
    id: 'finance-1', email: 'finance@example.com', full_name: 'Finance',
    memberships: [
      { organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'finance', role_label: 'Finance (démo)' },
    ],
  };

  it('entre dans apps/web : À faire, virements, appels et encaissements (lecture seule), comptes — R03, PO-16', async () => {
    localStorage.setItem('keya_access_token', 'stored-finance-token');
    const getMyInboxTasks = vi.fn().mockResolvedValue([]);
    const api = createMockApiClient({
      getMe: vi.fn().mockResolvedValue(ME_FINANCE),
      getMyInboxTasks,
      listReservations: vi.fn().mockResolvedValue([]),
    });
    render(withApiClient(api, <App />));

    await screen.findByTestId('app-shell');
    const sidebar = screen.getByRole('complementary', { name: 'Navigation des modules' });
    const labels = Array.from(sidebar.querySelectorAll('a')).map((link) => link.textContent);
    // Adapté selon PO-2026-09-28-01 : « Virements déclarés » devient « Encaissements ».
    // Adapté selon PO-2026-09-28-12 : « Appels et encaissements » devient « Appels par dossier ».
    expect(labels).toEqual(['À faire', 'Encaissements', 'Appels par dossier', 'Comptes & décaissements']);
    expect(screen.queryByRole('link', { name: 'Dossiers clients' })).not.toBeInTheDocument();
    expect(getMyInboxTasks).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('une connexion Finance redirige vers apps/web', async () => {
    const login = vi.fn().mockResolvedValue({ access: 'tok', refresh: 'ref' });
    const { redirect } = renderApp({ login, getMe: vi.fn().mockResolvedValue(ME_FINANCE) });

    await fillAndSubmit();

    await waitFor(() => expect(redirect).toHaveBeenCalledWith(expect.stringContaining('localhost:5176')));
  });
});

describe('App — pages publiques (ticket F-079)', () => {
  const PROGRAM = {
    id: 'program-1', name: 'Résidence Démonstration Abidjan', constructeur: 'Constructeur Démonstration', locations: ['Cocody'],
    currency: 'XOF', total_lots: 2, available_lots: 1, price_from: '30000000.00',
    lots: [{ id: 'lot-1', name: 'Lot A1', asset: 'Bâtiment A', surface: '82.00', price: '30000000.00' }],
    payment_schedule: {
      reservation_fee: '100000',
      steps: [
        { code: 'reservation', label: 'Premier versement (réservation)', cumulative_cap_percent: '10.00' },
        { code: 'livraison', label: 'Livraison', cumulative_cap_percent: '100.00' },
      ],
    },
  };
  const WORKSITE = {
    program: 'Résidence Démonstration Abidjan', lot: 'Lot A1', location: 'Cocody', accepted: 1, total: 2,
    milestones: [
      { label: 'Fondations', status: 'accepted', status_label: 'Accepté techniquement' },
      { label: 'Gros œuvre', status: 'awaiting_control', status_label: 'En attente de contrôle' },
    ],
  };

  it('sans session, `/` affiche la page d’accueil publique : programmes, chantiers, simulateur', async () => {
    const getPublicOffer = vi.fn().mockResolvedValue([PROGRAM]);
    const getPublicWorksites = vi.fn().mockResolvedValue([WORKSITE]);
    renderApp({ getPublicOffer, getPublicWorksites }, vi.fn(), '/');

    // Audit UI R1 : titre décrivant la démonstration (J02) ; le marquage démo
    // est désormais le bandeau commun à tous les écrans, monté à la racine
    // de chaque app (M01, voir demoMarkingGovernance.test.ts).
    expect(screen.getByRole('heading', { level: 1, name: 'Suivre un achat immobilier neuf, du versement au chantier' })).toBeInTheDocument();
    const program = await screen.findByTestId('public-program');
    expect(program).toHaveTextContent('Résidence Démonstration Abidjan');
    expect(program).toHaveTextContent('1 lot disponible');
    // Adapté selon PO-2026-09-28-32 : plus de section « Chantiers » montrant
    // l'état réel des lots ; seule la frise figée illustre le suivi.
    expect(screen.queryByTestId('public-worksite')).not.toBeInTheDocument();
    expect(getPublicWorksites).not.toHaveBeenCalled();
    expect(screen.getByTestId('facade-timeline')).toBeInTheDocument();
    // Simulateur : prix du lot le moins cher par défaut, échéancier du barème.
    expect(screen.getByTestId('simulated-price').textContent!.replace(/\s/g, ' ')).toBe('30 000 000 XOF');
    expect(screen.getAllByTestId('simulator-row').map((row) => row.textContent!.replace(/\s/g, ' '))).toEqual([
      expect.stringContaining('100 000 XOF'),
      expect.stringContaining('2 900 000 XOF'),
      expect.stringContaining('27 000 000 XOF'),
    ]);
    // Aucun formulaire de connexion sur l'accueil, aucun faux témoignage.
    expect(screen.queryByLabelText('Connexion')).not.toBeInTheDocument();
    expect(screen.queryByText(/ce qu.en disent nos clients/i)).not.toBeInTheDocument();
  });

  it('un programme complet reste affiché, sans bouton de réservation', async () => {
    renderApp({ getPublicOffer: vi.fn().mockResolvedValue([{ ...PROGRAM, available_lots: 0, lots: [] }]) }, vi.fn(), '/');

    const program = await screen.findByTestId('public-program');
    expect(program).toHaveTextContent('Complet');
    expect(screen.queryByRole('button', { name: /Réserver/ })).not.toBeInTheDocument();
  });

  it('« Se connecter » ouvre le formulaire à /connexion, sans rechargement ; le retour navigateur revient à l’accueil', async () => {
    renderApp({}, vi.fn(), '/');

    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(screen.getByLabelText('Connexion')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/connexion');

    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Suivre un achat immobilier neuf, du versement au chantier' })).toBeInTheDocument();
  });

  // Audit UI R1 (R01, PO-2026-09-27-08) : l'inscription publique est
  // retirée ; ces tests remplacent ceux du formulaire d'inscription (F-079).
  it.each(['/acces', '/inscription'])('%s affiche « Accès sur invitation », sans aucun formulaire d’identité', (path) => {
    renderApp({}, vi.fn(), path);

    expect(screen.getByRole('heading', { level: 1, name: 'Accès sur invitation' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Nom complet|Email|Mot de passe/)).not.toBeInTheDocument();
    expect(screen.getByText(/n’indiquez jamais d’identité/)).toBeInTheDocument();
  });

  it('« Réserver » sur un programme mène à l’accès sur invitation, jamais à une inscription', async () => {
    renderApp({ getPublicOffer: vi.fn().mockResolvedValue([PROGRAM]), getPublicWorksites: vi.fn().mockResolvedValue([]) }, vi.fn(), '/');

    fireEvent.click(await screen.findByRole('button', { name: 'Réserver — accès sur invitation' }));
    expect(window.location.pathname).toBe('/acces');
    expect(screen.getByRole('heading', { level: 1, name: 'Accès sur invitation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Créer mon espace/ })).not.toBeInTheDocument();
  });
});

describe('App — pages publiques : ordre des programmes (ticket F-079)', () => {
  it('les programmes avec des lots disponibles passent avant les programmes complets', async () => {
    const base = {
      constructeur: 'C', locations: [], currency: 'XOF', total_lots: 1, price_from: '10000000.00',
      payment_schedule: { reservation_fee: '100000', steps: [] },
    };
    renderApp({
      getPublicOffer: vi.fn().mockResolvedValue([
        { ...base, id: 'full', name: 'Programme complet', available_lots: 0, lots: [] },
        {
          ...base, id: 'open', name: 'Programme ouvert', available_lots: 1, price_from: '20000000.00',
          lots: [{ id: 'l', name: 'Lot 1', asset: 'A', surface: null, price: '20000000.00' }],
        },
      ]),
    }, vi.fn(), '/');

    const cards = await screen.findAllByTestId('public-program');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(['Programme ouvert', 'Programme complet']);
    expect(screen.getByTestId('simulated-price').textContent!.replace(/\s/g, ' ')).toBe('20 000 000 XOF');
  });
});
