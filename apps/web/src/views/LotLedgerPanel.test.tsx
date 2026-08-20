import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { LotBcCharge, LotLedger } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { LotLedgerPanel } from './LotLedgerPanel';

const ORGANIZATION_ID = 'org-lot-1';
const LOT_ID = 'lot-1';

function makeLedger(overrides: Partial<LotLedger> = {}): LotLedger {
  return {
    id: 'ledger-1',
    organization: ORGANIZATION_ID,
    lot: LOT_ID,
    prix_client: '18000000.00',
    foncier_alloue: '2000000.00',
    be_alloue: '500000.00',
    created_by: 'admin-1',
    created_at: '2026-08-20T09:00:00Z',
    ...overrides,
  };
}

function makeBcCharge(overrides: Partial<LotBcCharge> = {}): LotBcCharge {
  return {
    id: 'bc-charge-1',
    organization: ORGANIZATION_ID,
    lot: LOT_ID,
    mission: 'mission-1',
    jalon_type: 'conception',
    montant: '150000.00',
    is_global_reference: false,
    created_by: 'admin-1',
    created_at: '2026-08-10T09:00:00Z',
    ...overrides,
  };
}

function renderPanel(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    // Ticket F-035 bis (B-036) — mock par défaut pour que les tests
    // écrits AVANT l'intégration des charges BC n'aient pas besoin d'être
    // touchés un par un : `LotBcChargesPanel` se monte désormais sur
    // CHAQUE rendu du panneau, quel que soit l'état du grand-livre.
    getLotBcCharges: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
  render(withApiClient(api, <LotLedgerPanel organizationId={ORGANIZATION_ID} lotId={LOT_ID} />));
  return { api };
}

describe('LotLedgerPanel — chargement (ticket F-035)', () => {
  it('affiche un état de chargement puis une erreur explicite, avec un bouton "Réessayer"', async () => {
    const getLotLedger = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(null);
    renderPanel({ getLotLedger });

    expect(await screen.findByText('Impossible de charger le grand-livre.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText("Aucun grand-livre n'existe encore pour ce lot.")).toBeInTheDocument();
    expect(getLotLedger).toHaveBeenCalledTimes(2);
  });
});

describe('LotLedgerPanel — création (aucun grand-livre existant, ticket F-035)', () => {
  it('affiche le formulaire de création quand getLotLedger renvoie null', async () => {
    renderPanel({ getLotLedger: vi.fn().mockResolvedValue(null) });

    expect(await screen.findByLabelText('Prix client')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer le grand-livre' })).toBeInTheDocument();
  });

  it(
    'soumettre appelle createLotLedger({organization, lot, prix_client}), '
    + 'recharge le grand-livre affiché',
    async () => {
      const getLotLedger = vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeLedger());
      const createLotLedger = vi.fn().mockResolvedValue(makeLedger());
      renderPanel({
        getLotLedger,
        createLotLedger,
        getLotLedgerMargin: vi.fn().mockResolvedValue({ margin: '3000000.00' }),
      });

      await screen.findByLabelText('Prix client');
      fireEvent.change(screen.getByLabelText('Prix client'), { target: { value: '18000000.00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Créer le grand-livre' }));

      await waitFor(() => expect(createLotLedger).toHaveBeenCalledWith({
        organization: ORGANIZATION_ID, lot: LOT_ID, prix_client: '18000000.00',
      }));
      expect(await screen.findByTestId('lot-ledger-prix-client')).toHaveTextContent('18000000.00');
      expect(getLotLedger).toHaveBeenCalledTimes(2);
    },
  );

  it(
    'un 409 (LotDevisNotLockedError) affiche le message backend EXACT, jamais un message générique',
    async () => {
      const createLotLedger = vi.fn().mockRejectedValue(
        new ApiError(409, 'Échec', 'Le devis de ce lot doit être verrouillé avant de créer son grand-livre.'),
      );
      renderPanel({ getLotLedger: vi.fn().mockResolvedValue(null), createLotLedger });

      await screen.findByLabelText('Prix client');
      fireEvent.change(screen.getByLabelText('Prix client'), { target: { value: '18000000.00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Créer le grand-livre' }));

      expect(
        await screen.findByText('Le devis de ce lot doit être verrouillé avant de créer son grand-livre.'),
      ).toBeInTheDocument();
    },
  );

  it(
    'une erreur 400 DRF de validation (prix_client mal formé) affiche le message backend, '
    + 'via le même utilitaire que PricingView/LegalPaymentTiersView',
    async () => {
      const createLotLedger = vi.fn().mockRejectedValue(
        new ApiError(400, 'Échec', undefined, { prix_client: ['Un nombre valide est requis.'] }),
      );
      renderPanel({ getLotLedger: vi.fn().mockResolvedValue(null), createLotLedger });

      await screen.findByLabelText('Prix client');
      fireEvent.change(screen.getByLabelText('Prix client'), { target: { value: 'abc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Créer le grand-livre' }));

      expect(await screen.findByText('Un nombre valide est requis.')).toBeInTheDocument();
    },
  );
});

describe('LotLedgerPanel — détail d\'un grand-livre existant (ticket F-035)', () => {
  it('affiche prix client / foncier alloué / BE alloué tels que renvoyés, sans aucun calcul', async () => {
    renderPanel({
      getLotLedger: vi.fn().mockResolvedValue(makeLedger()),
      getLotLedgerMargin: vi.fn().mockResolvedValue({ margin: '3000000.00' }),
    });

    expect(await screen.findByTestId('lot-ledger-prix-client')).toHaveTextContent('18000000.00');
    expect(screen.getByTestId('lot-ledger-foncier-alloue')).toHaveTextContent('2000000.00');
    expect(screen.getByTestId('lot-ledger-be-alloue')).toHaveTextContent('500000.00');
  });

  it(
    'mentionne explicitement que la construction courante n\'est pas exposée comme poste '
    + 'isolé (dépendance backend, jamais un silence)',
    async () => {
      renderPanel({
        getLotLedger: vi.fn().mockResolvedValue(makeLedger()),
        getLotLedgerMargin: vi.fn().mockResolvedValue({ margin: '3000000.00' }),
      });

      expect(await screen.findByText(/Détail de la construction/)).toBeInTheDocument();
      expect(screen.getByText(/n'est pas encore exposé comme poste séparé/)).toBeInTheDocument();
    },
  );

  it('une marge disponible POSITIVE s\'affiche en texte simple', async () => {
    renderPanel({
      getLotLedger: vi.fn().mockResolvedValue(makeLedger()),
      getLotLedgerMargin: vi.fn().mockResolvedValue({ margin: '3000000.00' }),
    });

    const margin = await screen.findByTestId('lot-ledger-margin');
    expect(margin).toHaveTextContent('3000000.00');
    expect(screen.queryByText(/négative/)).not.toBeInTheDocument();
  });

  it(
    'une marge disponible NÉGATIVE est visuellement distincte (AlertBanner), '
    + 'jamais confondue avec une marge positive',
    async () => {
      renderPanel({
        getLotLedger: vi.fn().mockResolvedValue(makeLedger()),
        getLotLedgerMargin: vi.fn().mockResolvedValue({ margin: '-450000.00' }),
      });

      expect(await screen.findByText('Marge disponible : -450000.00 (négative)')).toBeInTheDocument();
      expect(screen.queryByTestId('lot-ledger-margin')).not.toBeInTheDocument();
    },
  );

  it('un échec de chargement de la marge affiche une erreur distincte, avec "Réessayer"', async () => {
    const getLotLedgerMargin = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ margin: '3000000.00' });
    renderPanel({
      getLotLedger: vi.fn().mockResolvedValue(makeLedger()),
      getLotLedgerMargin,
    });

    await screen.findByText('Impossible de charger la marge disponible.');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByTestId('lot-ledger-margin')).toHaveTextContent('3000000.00');
  });
});

describe(
  'LotLedgerPanel — charges bureau de contrôle (ticket F-035 bis, backend B-036, LotBcCharge)',
  () => {
    it('affiche un état vide explicite quand aucune charge n\'existe encore', async () => {
      renderPanel({
        getLotLedger: vi.fn().mockResolvedValue(null),
        getLotBcCharges: vi.fn().mockResolvedValue([]),
      });

      expect(await screen.findByText('Charges bureau de contrôle')).toBeInTheDocument();
      expect(
        await screen.findByText('Aucune charge bureau de contrôle enregistrée pour l\'instant.'),
      ).toBeInTheDocument();
    });

    it(
      'reste visible et appelle getLotBcCharges MÊME quand aucun grand-livre n\'existe encore '
      + '(LotBcCharge a une FK directe vers Lot, indépendante de LotLedger)',
      async () => {
        const getLotBcCharges = vi.fn().mockResolvedValue([]);
        renderPanel({
          getLotLedger: vi.fn().mockResolvedValue(null),
          getLotBcCharges,
        });

        expect(await screen.findByLabelText('Prix client')).toBeInTheDocument();
        expect(await screen.findByText('Charges bureau de contrôle')).toBeInTheDocument();
        await waitFor(() => expect(getLotBcCharges).toHaveBeenCalledWith(LOT_ID, ORGANIZATION_ID));
      },
    );

    it(
      'liste chaque charge telle que renvoyée par l\'API, sans afficher de total calculé côté frontend',
      async () => {
        renderPanel({
          getLotLedger: vi.fn().mockResolvedValue(makeLedger()),
          getLotLedgerMargin: vi.fn().mockResolvedValue({ margin: '2700000.00' }),
          getLotBcCharges: vi.fn().mockResolvedValue([
            makeBcCharge({ id: 'bc-1', jalon_type: 'conception', montant: '150000.00', is_global_reference: false }),
            makeBcCharge({ id: 'bc-2', jalon_type: 'global', montant: '150000.00', is_global_reference: true }),
          ]),
        });

        expect(await screen.findByText('conception')).toBeInTheDocument();
        expect(screen.getAllByText('150000.00')).toHaveLength(2);
        expect(screen.getByText('Tarif fixe (jalon)')).toBeInTheDocument();
        expect(screen.getByText('Forfait global')).toBeInTheDocument();
        // Aucun total (ex. "300000.00") n'est calculé/affiché ici — la
        // somme est déjà intégrée à la marge, jamais recalculée côté
        // frontend (voir docstring de LotBcChargesPanel).
        expect(screen.queryByText('300000.00')).not.toBeInTheDocument();
      },
    );

    it('un échec de chargement affiche une erreur distincte, avec "Réessayer"', async () => {
      const getLotBcCharges = vi.fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce([makeBcCharge()]);
      renderPanel({
        getLotLedger: vi.fn().mockResolvedValue(null),
        getLotBcCharges,
      });

      await screen.findByText('Impossible de charger les charges bureau de contrôle.');
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

      expect(await screen.findByText('conception')).toBeInTheDocument();
    });
  },
);
