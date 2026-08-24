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
  // Ticket F-031 : l'onglet actif est désormais dérivé du pathname — jamais
  // laisser un test qui navigue (ci-dessous) contaminer le pathname d'un
  // test suivant dans ce même fichier (jsdom partage `window` par fichier).
  window.history.replaceState(null, '', '/');
});

function renderApp(overrides: Parameters<typeof createMockApiClient>[0] = {}, redirect = vi.fn()) {
  const api = createMockApiClient({ getAdminTasks: async () => [], ...overrides });
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
      const api = createMockApiClient({ getAdminTasks: async () => [], ...overrides });
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
      expect(screen.getByLabelText('Rechercher un utilisateur par email')).toBeInTheDocument();
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
        const getMe = vi.fn().mockResolvedValue({
          id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
          memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
        });
        renderAuthenticated({ getMe });

        await screen.findByTestId('app-shell');
        expect(screen.getByRole('button', { name: 'Back-office' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByLabelText('Rechercher un lot (nom)')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: "Devis / Appels d'offres" }));

        expect(await screen.findByLabelText('Rechercher un lot (nom)')).toBeInTheDocument();
        expect(screen.queryByLabelText('Rechercher un utilisateur par email')).not.toBeInTheDocument();
      },
    );
  },
);

describe(
  'App — navigation par URL des écrans admin (ticket F-031)',
  () => {
    function renderAuthenticated(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
      localStorage.setItem('keya_access_token', 'stored-admin-token');
      const api = createMockApiClient({ getAdminTasks: async () => [], ...overrides });
      render(withApiClient(api, <App />));
      return { api };
    }

    const getMeAdmin = () => vi.fn().mockResolvedValue({
      id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
      memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
    });

    it('charger directement /tarifs affiche l\'onglet Tarifs actif, jamais Back-office par défaut', async () => {
      window.history.replaceState(null, '', '/tarifs');
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      expect(screen.getByRole('button', { name: 'Tarifs' })).toHaveAttribute('aria-current', 'page');
      expect(screen.queryByLabelText('Rechercher un utilisateur par email')).not.toBeInTheDocument();
    });

    it('changer d\'onglet via TabBar met à jour l\'URL (pushState), sans recharger la page', async () => {
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      fireEvent.click(screen.getByRole('button', { name: "Devis / Appels d'offres" }));

      await screen.findByLabelText('Rechercher un lot (nom)');
      expect(window.location.pathname).toBe('/devis');
    });

    it('le bouton retour du navigateur restaure l\'onglet précédent', async () => {
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      fireEvent.click(screen.getByRole('button', { name: 'Paliers légaux' }));
      await screen.findByRole('heading', { name: /paliers légaux/i });

      act(() => {
        window.history.replaceState(null, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(await screen.findByRole('button', { name: 'Back-office' })).toHaveAttribute('aria-current', 'page');
    });

    it('un chemin admin inconnu retombe sur Back-office et corrige l\'URL affichée', async () => {
      window.history.replaceState(null, '', '/ecran-qui-n-existe-pas');
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      expect(screen.getByRole('button', { name: 'Back-office' })).toHaveAttribute('aria-current', 'page');
      expect(window.location.pathname).toBe('/');
    });

    // Ticket F-049 — nouvel onglet "Programmes" (création Program/Asset/Lot).
    it('changer d\'onglet vers Programmes affiche ProgramsView et met à jour l\'URL', async () => {
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      fireEvent.click(screen.getByRole('button', { name: 'Programmes' }));

      await screen.findByRole('heading', { name: 'Programmes' });
      expect(window.location.pathname).toBe('/programmes');
    });

    // Ticket F-058 — pendant admin de ProgramRequestView.tsx (apps/home).
    it('changer d\'onglet vers Demandes de programme affiche ProgramRequestsView et met à jour l\'URL', async () => {
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      fireEvent.click(screen.getByRole('button', { name: 'Demandes de programme' }));

      await screen.findByRole('heading', { name: 'Demandes de programme' });
      expect(window.location.pathname).toBe('/demandes-programme');
    });

    // Ticket F-051 — regroupement de sidebar (AppShell), premier usage réel.
    it('la sidebar affiche "Ventes & tarification" au-dessus de Devis/Tarifs/Paliers légaux', async () => {
      renderAuthenticated({ getMe: getMeAdmin() });

      await screen.findByTestId('app-shell');
      expect(screen.getByText('Ventes & tarification')).toBeInTheDocument();
      // Back-office et Programmes restent de premier niveau, aucun en-tête.
      expect(screen.getAllByText('Ventes & tarification')).toHaveLength(1);
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
      getAdminTasks: async () => [],
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
      getAdminTasks: async () => [
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

  it('affiche 0 en l\'absence de tâche en attente', async () => {
    renderAuthenticated({ getAdminTasks: async () => [] });

    expect(await screen.findByTestId('task-inbox-count')).toHaveTextContent('0');
  });
});

describe('App — clic sur la cloche AppShell (ticket F-061)', () => {
  it('bascule sur l\'onglet « Tâches » et met à jour l\'URL, jamais un rechargement complet', async () => {
    localStorage.setItem('keya_access_token', 'stored-admin-token');
    const api = createMockApiClient({
      getMe: vi.fn().mockResolvedValue({
        id: 'admin-1', email: 'admin@example.com', full_name: 'Admin',
        memberships: [{ organization_id: 'org-keyimmo', organization_name: 'KEYIMMO', role_code: 'admin_keyimmo', role_label: 'Admin' }],
      }),
      getAdminTasks: async () => [],
    });
    render(withApiClient(api, <App />));
    await screen.findByTestId('app-shell');

    fireEvent.click(screen.getByRole('link', { name: /Task Inbox/ }));

    expect(await screen.findByRole('heading', { name: 'Tâches' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/tasks');
  });
});
