import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { BackofficeUserDetail, BackofficeUserSummary } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { BackofficeView } from './BackofficeView';

const SEARCH_RESULT: BackofficeUserSummary = {
  id: 'target-1', email: 'cible@example.com', full_name: 'Cible Constructeur', is_active: true,
};

const USER_DETAIL: BackofficeUserDetail = {
  user: SEARCH_RESULT,
  memberships: [
    { organization_id: 'org-1', organization_name: 'Org Constructeur', role: 'constructeur' },
    { organization_id: 'org-2', organization_name: 'Org Sponsor', role: 'sponsor' },
  ],
};

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient(overrides);
  render(withApiClient(api, <BackofficeView />));
  return { api };
}

async function search(query = 'cible') {
  fireEvent.change(screen.getByLabelText('Rechercher un utilisateur par email'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
}

describe('BackofficeView — recherche d\'utilisateur (ticket 011/021)', () => {
  it('soumet la requête telle que saisie à searchUsers, affiche les résultats', async () => {
    const searchUsers = vi.fn().mockResolvedValue([SEARCH_RESULT]);
    renderView({ searchUsers });

    await search('cible');

    await waitFor(() => expect(searchUsers).toHaveBeenCalledWith('cible'));
    expect(await screen.findByRole('button', { name: /cible@example.com — Cible Constructeur/ })).toBeInTheDocument();
  });

  it('une liste vide affiche "Aucun utilisateur trouvé.", jamais un tableau vide silencieux', async () => {
    renderView({ searchUsers: vi.fn().mockResolvedValue([]) });

    await search();

    expect(await screen.findByTestId('no-results')).toBeInTheDocument();
  });

  it('un échec réseau affiche une erreur explicite', async () => {
    renderView({ searchUsers: vi.fn().mockRejectedValue(new Error('network down')) });

    await search();

    expect(await screen.findByRole('alert')).toHaveTextContent("Impossible d'effectuer la recherche.");
  });

  it('affiche un bouton "Réessayer" sur l\'erreur, qui relance EXACTEMENT la même recherche (ticket F-033)', async () => {
    const searchUsers = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([SEARCH_RESULT]);
    renderView({ searchUsers });

    await search('cible');
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByRole('button', { name: /cible@example.com/ })).toBeInTheDocument();
    expect(searchUsers).toHaveBeenNthCalledWith(2, 'cible');
  });

  it(
    'un 403 affiche "Accès refusé" (jamais retentable), distinct du message '
    + 'générique — ticket F-033 (vague 4)',
    async () => {
      renderView({ searchUsers: vi.fn().mockRejectedValue(new ApiError(403, 'Permission refusée')) });

      await search();

      expect(await screen.findByText('Accès refusé')).toBeInTheDocument();
      expect(screen.queryByText("Impossible d'effectuer la recherche.")).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
    },
  );

  it('un compte désactivé est signalé directement dans la liste de résultats', async () => {
    renderView({
      searchUsers: vi.fn().mockResolvedValue([{ ...SEARCH_RESULT, is_active: false }]),
    });

    await search();

    expect(await screen.findByText(/\(compte désactivé\)/)).toBeInTheDocument();
  });
});

describe('BackofficeView — consultation organisation/rôle (ticket 011/021)', () => {
  it('affiche CHAQUE organisation et le rôle associé pour l\'utilisateur sélectionné', async () => {
    const getUserDetail = vi.fn().mockResolvedValue(USER_DETAIL);
    renderView({ searchUsers: vi.fn().mockResolvedValue([SEARCH_RESULT]), getUserDetail });

    await search();
    fireEvent.click(await screen.findByRole('button', { name: /cible@example.com/ }));

    expect(getUserDetail).toHaveBeenCalledWith('target-1');
    expect(await screen.findByText('Org Constructeur — constructeur')).toBeInTheDocument();
    expect(screen.getByText('Org Sponsor — sponsor')).toBeInTheDocument();
  });

  it('sélectionner un AUTRE utilisateur remplace le panneau, ne l\'empile jamais', async () => {
    const getUserDetail = vi.fn()
      .mockResolvedValueOnce(USER_DETAIL)
      .mockResolvedValueOnce({
        user: { id: 'target-2', email: 'autre@example.com', full_name: 'Autre', is_active: true },
        memberships: [],
      });
    renderView({
      searchUsers: vi.fn().mockResolvedValue([
        SEARCH_RESULT,
        { id: 'target-2', email: 'autre@example.com', full_name: 'Autre', is_active: true },
      ]),
      getUserDetail,
    });

    await search();
    fireEvent.click(await screen.findByRole('button', { name: /cible@example.com/ }));
    await screen.findByText('Org Constructeur — constructeur');

    fireEvent.click(screen.getByRole('button', { name: /autre@example.com/ }));

    await waitFor(() => expect(screen.queryByText('Org Constructeur — constructeur')).not.toBeInTheDocument());
    expect(await screen.findByText('Aucune organisation.')).toBeInTheDocument();
  });

  it('un échec réseau affiche une erreur explicite, avec un bouton "Réessayer" (ticket F-033)', async () => {
    const getUserDetail = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(USER_DETAIL);
    renderView({ searchUsers: vi.fn().mockResolvedValue([SEARCH_RESULT]), getUserDetail });

    await search();
    fireEvent.click(await screen.findByRole('button', { name: /cible@example.com/ }));
    await screen.findByText('Impossible de charger ce profil.');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Org Constructeur — constructeur')).toBeInTheDocument();
    expect(getUserDetail).toHaveBeenCalledTimes(2);
  });
});

describe(
  'BackofficeView — désactivation avec confirmation EXPLICITE (ticket 021, point 3 du scope) : '
  + 'jamais un simple clic n\'exécute l\'action destructive',
  () => {
    async function selectUser(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
      const getUserDetail = vi.fn().mockResolvedValue(USER_DETAIL);
      const result = renderView({
        searchUsers: vi.fn().mockResolvedValue([SEARCH_RESULT]),
        getUserDetail,
        ...overrides,
      });
      await search();
      fireEvent.click(await screen.findByRole('button', { name: /cible@example.com/ }));
      await screen.findByText('Org Constructeur — constructeur');
      return result;
    }

    it('le premier clic sur "Désactiver ce compte" n\'appelle PAS deactivateUser — il affiche une confirmation', async () => {
      const deactivateUser = vi.fn();
      await selectUser({ deactivateUser });

      fireEvent.click(screen.getByRole('button', { name: 'Désactiver ce compte' }));

      expect(deactivateUser).not.toHaveBeenCalled();
      expect(await screen.findByText('Confirmer la désactivation du compte')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirmer la désactivation' })).toBeInTheDocument();
    });

    it('"Annuler" ferme la confirmation sans jamais appeler deactivateUser', async () => {
      const deactivateUser = vi.fn();
      await selectUser({ deactivateUser });

      fireEvent.click(screen.getByRole('button', { name: 'Désactiver ce compte' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));

      expect(deactivateUser).not.toHaveBeenCalled();
      expect(screen.queryByText('Confirmer la désactivation du compte')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Désactiver ce compte' })).toBeInTheDocument();
    });

    it('seul le SECOND clic ("Confirmer la désactivation") appelle réellement deactivateUser', async () => {
      const deactivateUser = vi.fn().mockResolvedValue({ ...SEARCH_RESULT, is_active: false });
      await selectUser({ deactivateUser });

      fireEvent.click(screen.getByRole('button', { name: 'Désactiver ce compte' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirmer la désactivation' }));

      await waitFor(() => expect(deactivateUser).toHaveBeenCalledWith('target-1'));
    });

    it('après confirmation réussie, relit le profil réel (compte désactivé affiché, plus de bouton de désactivation)', async () => {
      const getUserDetail = vi.fn()
        .mockResolvedValueOnce(USER_DETAIL)
        .mockResolvedValueOnce({ ...USER_DETAIL, user: { ...USER_DETAIL.user, is_active: false } });
      const deactivateUser = vi.fn().mockResolvedValue({ ...SEARCH_RESULT, is_active: false });
      await selectUser({ getUserDetail, deactivateUser });

      fireEvent.click(screen.getByRole('button', { name: 'Désactiver ce compte' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirmer la désactivation' }));

      await waitFor(() => expect(screen.getByTestId('account-status')).toHaveTextContent('Compte désactivé'));
      expect(screen.queryByRole('button', { name: 'Désactiver ce compte' })).not.toBeInTheDocument();
      expect(getUserDetail).toHaveBeenCalledTimes(2);
    });

    it('un échec de deactivateUser affiche une erreur, garde la confirmation ouverte, ne prétend jamais avoir réussi', async () => {
      const deactivateUser = vi.fn().mockRejectedValue(new Error('network down'));
      await selectUser({ deactivateUser });

      fireEvent.click(screen.getByRole('button', { name: 'Désactiver ce compte' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirmer la désactivation' }));

      expect(await screen.findByText('Échec de la désactivation.')).toBeInTheDocument();
      expect(screen.getByTestId('account-status')).toHaveTextContent('Compte actif');
    });

    it(
      'un compte DÉJÀ désactivé ne propose aucun bouton de désactivation (rien à confirmer)',
      async () => {
        const getUserDetail = vi.fn().mockResolvedValue({
          ...USER_DETAIL, user: { ...USER_DETAIL.user, is_active: false },
        });
        await selectUser({ getUserDetail });

        expect(screen.queryByRole('button', { name: 'Désactiver ce compte' })).not.toBeInTheDocument();
      },
    );
  },
);

describe(
  'BackofficeView — garde de non-régression (ticket 021, point 4 du scope) : aucune action '
  + 'ne doit suggérer un raccourci sur un TrustEvent, même raisonnement que '
  + 'TestBackofficeNeverExposesATrustEventShortcut côté backend (ticket 011) et le scan de '
  + 'boutons interdits de apps/build/src/views/ExceptionsView.test.tsx (ticket 009)',
  () => {
    it('aucun bouton rendu (recherche, détail, confirmation) n\'évoque un TrustEvent/une décision métier', async () => {
      const getUserDetail = vi.fn().mockResolvedValue(USER_DETAIL);
      renderView({ searchUsers: vi.fn().mockResolvedValue([SEARCH_RESULT]), getUserDetail });

      await search();
      fireEvent.click(await screen.findByRole('button', { name: /cible@example.com/ }));
      await screen.findByText('Org Constructeur — constructeur');
      fireEvent.click(screen.getByRole('button', { name: 'Désactiver ce compte' }));
      await screen.findByText('Confirmer la désactivation du compte');

      const forbidden = /trust ?event|valider|lever la réserve|résoudre|marquer conforme|changer le statut|réserve/i;
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button.textContent ?? '').not.toMatch(forbidden);
      }
    });

    it('le texte de confirmation ne parle QUE de l\'accès du compte, jamais d\'un objet métier', async () => {
      const getUserDetail = vi.fn().mockResolvedValue(USER_DETAIL);
      renderView({ searchUsers: vi.fn().mockResolvedValue([SEARCH_RESULT]), getUserDetail });

      await search();
      fireEvent.click(await screen.findByRole('button', { name: /cible@example.com/ }));
      await screen.findByText('Org Constructeur — constructeur');
      fireEvent.click(screen.getByRole('button', { name: 'Désactiver ce compte' }));

      const banner = await screen.findByRole('alert');
      expect(banner.textContent).toMatch(/accès/i);
      expect(banner.textContent ?? '').not.toMatch(/trust ?event|réserve|jalon|milestone/i);
    });
  },
);
