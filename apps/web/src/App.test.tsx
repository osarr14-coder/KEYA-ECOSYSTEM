import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './api/client';
import type { Me } from './api/types';
import { App } from './App';
import { createMockApiClient, withApiClient } from './testUtils';

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
