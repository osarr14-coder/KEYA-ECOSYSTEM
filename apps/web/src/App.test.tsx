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
  const api = createMockApiClient(overrides);
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
      const api = createMockApiClient(overrides);
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
      const api = createMockApiClient(overrides);
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
