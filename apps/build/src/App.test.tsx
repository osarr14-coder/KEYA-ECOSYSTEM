import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { ApiError } from './api/client';
import type { ExceptionsPayload, LotRow, PaginatedResponse } from './api/types';
import { App } from './App';
import { createMockApiClient, withApiClient } from './testUtils';

beforeEach(() => {
  // Ticket 019 : l'organisation active persiste en localStorage — jamais
  // laisser une valeur d'un test précédent contaminer le suivant.
  localStorage.clear();
});

const EMPTY_EXCEPTIONS: ExceptionsPayload = {
  lots_en_retard: [], controles_a_planifier: [], capacites_manquantes: [],
  reserves_ouvertes: [], documents_manquants: [],
};

function makePage(results: LotRow[]): PaginatedResponse<LotRow> {
  return { count: results.length, next: null, previous: null, results };
}

// Ticket 019 : une seule membership par défaut — le sélecteur d'organisation
// (AppShell) ne doit alors jamais apparaître, voir le describe dédié pour le
// cas à plusieurs organisations.
const SINGLE_MEMBERSHIP_ME = {
  id: 'user-1', email: 'constructeur@example.com', full_name: 'Constructeur Test',
  memberships: [
    {
      organization_id: 'org-1', organization_name: 'Org Constructeur',
      role_code: 'constructeur', role_label: 'Constructeur',
    },
  ],
};

function renderApp(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getMe: async () => SINGLE_MEMBERSHIP_ME,
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

describe(
  'App — lien "Accueil" (ticket F-040) : vraie navigation cross-origine vers HOME, '
  + 'jamais un chemin relatif mort (apps/build n\'a aucun routeur — `/` y rendrait '
  + 'la même vue Control Tower que `/build`)',
  () => {
    it(
      'construit un lien avec transfert de session (fragment access_token/refresh_token) '
      + 'quand une session est présente en localStorage',
      async () => {
        localStorage.setItem('keya_access_token', 'my-access');
        localStorage.setItem('keya_refresh_token', 'my-refresh');
        renderApp();
        await screen.findByTestId('no-exceptions');

        const accueilLink = screen.getByRole('link', { name: 'Accueil' });
        expect(accueilLink).toHaveAttribute(
          'href',
          'http://localhost:5173/#access_token=my-access&refresh_token=my-refresh',
        );
      },
    );

    it('retombe sur l\'origine HOME nue si aucune session n\'est encore en localStorage', async () => {
      renderApp();
      await screen.findByTestId('no-exceptions');

      expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute('href', 'http://localhost:5173');
    });
  },
);

describe(
  'App — App Switcher multi-rôle (ticket 019) : bascule entre organisations réelles, '
  + 'jamais un rôle codé en dur',
  () => {
    const TWO_MEMBERSHIPS_ME = {
      id: 'user-1', email: 'multi@example.com', full_name: 'Multi Org',
      memberships: [
        {
          organization_id: 'org-1', organization_name: 'Org Constructeur',
          role_code: 'constructeur', role_label: 'Constructeur',
        },
        { organization_id: 'org-2', organization_name: 'Org Sponsor', role_code: 'sponsor', role_label: 'Sponsor' },
      ],
    };

    it("n'affiche aucun sélecteur d'organisation quand l'utilisateur n'a qu'une seule membership", async () => {
      renderApp();

      await screen.findByTestId('no-exceptions');
      expect(screen.queryByLabelText('Organisation active')).not.toBeInTheDocument();
    });

    it('affiche un sélecteur listant CHAQUE organisation quand il y en a plusieurs', async () => {
      renderApp({ getMe: async () => TWO_MEMBERSHIPS_ME });

      const select = await screen.findByLabelText('Organisation active');
      const optionLabels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
      expect(optionLabels).toEqual(['Org Constructeur', 'Org Sponsor']);
    });

    it(
      'changer d\'organisation redéclenche un vrai appel réseau (getExceptions), persiste le choix '
      + 'en localStorage, et met à jour les modules visibles selon le RÔLE de la nouvelle organisation',
      async () => {
        // Organisation déjà résolue au chargement (utilisateur de retour) :
        // isole le comportement du SWITCH lui-même du double appel de
        // démarrage à froid (couvert par les tests dédiés ci-dessous).
        localStorage.setItem('keya_active_organization_id', 'org-1');
        const getExceptions = vi.fn().mockResolvedValue(EMPTY_EXCEPTIONS);
        renderApp({ getMe: async () => TWO_MEMBERSHIPS_ME, getExceptions });

        await screen.findByTestId('no-exceptions');
        expect(getExceptions).toHaveBeenCalledTimes(1);
        // Rôle 'constructeur' actif au départ : FINANCE (réservé à
        // 'sponsor') n'est pas visible.
        expect(screen.queryByText('FINANCE')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Organisation active'), { target: { value: 'org-2' } });

        // Un VRAI second appel réseau, pas seulement un changement d'affichage.
        await waitFor(() => expect(getExceptions).toHaveBeenCalledTimes(2));
        expect(localStorage.getItem('keya_active_organization_id')).toBe('org-2');
        // Rôle 'sponsor' de la nouvelle organisation active : FINANCE
        // devient visible.
        expect(await screen.findByText('FINANCE')).toBeInTheDocument();
      },
    );

    it(
      'reprend l\'organisation persistée en localStorage au chargement, sans attendre une '
      + 'interaction de l\'utilisateur',
      async () => {
        localStorage.setItem('keya_active_organization_id', 'org-2');
        renderApp({ getMe: async () => TWO_MEMBERSHIPS_ME });

        // Rôle 'sponsor' (org-2) actif dès le premier rendu.
        expect(await screen.findByText('FINANCE')).toBeInTheDocument();
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
    await screen.findByText('Aucune exception en ce moment — tout est à jour.');

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

    await screen.findByText('Aucune exception en ce moment — tout est à jour.');
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
