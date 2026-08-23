import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExceptionsPayload } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { ExceptionsView } from './ExceptionsView';

const EMPTY_EXCEPTIONS: ExceptionsPayload = {
  lots_en_retard: [], controles_a_planifier: [], capacites_manquantes: [],
  reserves_ouvertes: [], documents_manquants: [],
};

function renderView(
  overrides: Parameters<typeof createMockApiClient>[0] = {},
  onViewLotInTable = vi.fn(),
  activeOrganizationId: string | null = 'org-1',
) {
  const api = createMockApiClient({
    getExceptions: async () => EMPTY_EXCEPTIONS,
    ...overrides,
  });
  render(withApiClient(
    api,
    <ExceptionsView onViewLotInTable={onViewLotInTable} activeOrganizationId={activeOrganizationId} />,
  ));
  return { api, onViewLotInTable };
}

describe('ExceptionsView — état vide explicite (critère d\'acceptation)', () => {
  it("affiche un message explicite quand les 5 catégories sont vides, jamais un tableau de KPI", async () => {
    renderView();

    expect(await screen.findByTestId('no-exceptions')).toHaveTextContent(/aucune exception/i);
    // Aucun mot-clé évoquant un indicateur agrégé nulle part sur l'écran.
    expect(screen.queryByText(/kpi|indicateur|tableau de bord/i)).not.toBeInTheDocument();
  });

  it('affiche un message vide par catégorie même si d\'autres catégories ont des exceptions', async () => {
    renderView({
      getExceptions: async () => ({
        ...EMPTY_EXCEPTIONS,
        lots_en_retard: [{
          lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence', program_name: 'Programme',
          label: 'Aucune activité récente',
        }],
      }),
    });

    await screen.findByText('Lot 12');
    expect(screen.getByText('Aucun contrôle en attente de planification.')).toBeInTheDocument();
    expect(screen.getByText('Tous les lots ont une organisation constructrice affectée.')).toBeInTheDocument();
    expect(screen.getByText('Aucune réserve ouverte.')).toBeInTheDocument();
    expect(screen.getByText('Aucun document manquant.')).toBeInTheDocument();
    // Le bandeau "aucune exception" global ne doit PAS s'afficher puisqu'il
    // en existe au moins une.
    expect(screen.queryByTestId('no-exceptions')).not.toBeInTheDocument();
  });
});

describe('ExceptionsView — lots en retard / contrôles à planifier : navigation réelle', () => {
  it('le bouton "Voir dans Tous les lots" transmet le nom du lot', async () => {
    const { onViewLotInTable } = renderView({
      getExceptions: async () => ({
        ...EMPTY_EXCEPTIONS,
        lots_en_retard: [{
          lot_id: 'lot-1', lot_name: 'Lot Retard', asset_name: 'Résidence', program_name: 'Programme',
          label: 'Aucune activité récente',
        }],
      }),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Voir dans Tous les lots' }));

    expect(onViewLotInTable).toHaveBeenCalledWith('Lot Retard');
  });
});

describe('ExceptionsView — capacités manquantes : action réelle "Affecter"', () => {
  it('affecte le lot à l\'organisation active puis recharge les exceptions', async () => {
    const getExceptions = vi.fn()
      .mockResolvedValueOnce({
        ...EMPTY_EXCEPTIONS,
        capacites_manquantes: [{
          lot_id: 'lot-1', lot_name: 'Lot Sans Org', asset_name: 'Résidence', program_name: 'Programme',
          label: 'Aucune organisation constructrice affectée',
        }],
      })
      .mockResolvedValueOnce(EMPTY_EXCEPTIONS);
    const assignLotOrganization = vi.fn().mockResolvedValue({});

    // Ticket 019 : l'organisation active vient désormais de `App.tsx` (App
    // Switcher), passée en prop — plus un `getMe()` propre à cette action.
    renderView({ getExceptions, assignLotOrganization }, vi.fn(), 'org-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Affecter à mon organisation' }));

    await waitFor(() => expect(assignLotOrganization).toHaveBeenCalledWith('lot-1', 'org-1'));
    await waitFor(() => expect(getExceptions).toHaveBeenCalledTimes(2));
  });
});

describe('ExceptionsView — réserves ouvertes : StatusBadge + AlertBanner + action réelle', () => {
  const RESERVE_ROW = {
    lot_id: 'lot-1', lot_name: 'Lot Réserve', asset_name: 'Résidence', program_name: 'Programme',
    label: 'Réserve ouverte — Fissure en façade', reserve_id: 'reserve-1', status: 'ouverte',
    event: {
      level: 'controle' as const, source: 'inspection_avec_reserve', actor: 'inspecteur@example.com',
      scope: '', created_at: '2026-03-05T10:30:00Z',
    },
    available_evidence: [
      {
        id: 'evidence-1', milestone_label: 'Fondations', created_at: '2026-03-04T10:00:00Z',
        added_by_email: 'constructeur@example.com',
      },
    ],
  };

  it('affiche un AlertBanner (role=alert + icône) et un StatusBadge pour chaque réserve ouverte', async () => {
    renderView({
      getExceptions: async () => ({ ...EMPTY_EXCEPTIONS, reserves_ouvertes: [RESERVE_ROW] }),
    });

    await screen.findByText('Lot Réserve', { exact: false });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('[role="alert"] svg')).not.toBeNull();
    expect(screen.getByText('Contrôlé')).toBeInTheDocument();
  });

  it('soumet une correction avec la preuve sélectionnée', async () => {
    const createReserveCorrection = vi.fn().mockResolvedValue({});
    renderView({
      getExceptions: async () => ({ ...EMPTY_EXCEPTIONS, reserves_ouvertes: [RESERVE_ROW] }),
      createReserveCorrection,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Documenter une correction' }));

    await waitFor(() => expect(createReserveCorrection).toHaveBeenCalledWith('reserve-1', 'evidence-1'));
  });

  it("n'affiche aucun formulaire de correction quand aucune preuve n'est disponible pour le lot", async () => {
    renderView({
      getExceptions: async () => ({
        ...EMPTY_EXCEPTIONS,
        reserves_ouvertes: [{ ...RESERVE_ROW, available_evidence: [] }],
      }),
    });

    await screen.findByText(/ajoutez une preuve/i);
    expect(screen.queryByRole('button', { name: 'Documenter une correction' })).not.toBeInTheDocument();
  });

  it(
    'différencie deux preuves du même jalon et du même jour par leur auteur (ticket 014 — '
    + 'friction du rapport bout-en-bout : 5 entrées "Foncier — 16/08/2026" indiscernables)',
    async () => {
      renderView({
        getExceptions: async () => ({
          ...EMPTY_EXCEPTIONS,
          reserves_ouvertes: [{
            ...RESERVE_ROW,
            available_evidence: [
              {
                id: 'evidence-1', milestone_label: 'Foncier', created_at: '2026-08-16T09:00:00Z',
                added_by_email: 'alice@example.com',
              },
              {
                id: 'evidence-2', milestone_label: 'Foncier', created_at: '2026-08-16T14:00:00Z',
                added_by_email: 'bob@example.com',
              },
            ],
          }],
        }),
      });

      await screen.findByText('Lot Réserve', { exact: false });
      const options = screen.getAllByRole('option') as HTMLOptionElement[];
      const labels = options.map((option) => option.textContent);
      expect(labels[0]).toContain('alice@example.com');
      expect(labels[1]).toContain('bob@example.com');
      expect(labels[0]).not.toBe(labels[1]);
    },
  );

  it(
    'ne propose JAMAIS de bouton permettant de changer directement le statut de la réserve (critère de sécurité)',
    async () => {
      renderView({
        getExceptions: async () => ({ ...EMPTY_EXCEPTIONS, reserves_ouvertes: [RESERVE_ROW] }),
      });

      await screen.findByText('Lot Réserve', { exact: false });
      const forbidden = /résoudre|fermer la réserve|marquer conforme|lever la réserve|changer le statut/i;
      const buttons = screen.getAllByRole('button');
      for (const button of buttons) {
        expect(button.textContent ?? '').not.toMatch(forbidden);
      }
    },
  );
});

describe('ExceptionsView — documents manquants : action réelle d\'upload', () => {
  it('envoie le document puis crée l\'evidence rattachée à la déclaration', async () => {
    const addEvidenceDocument = vi.fn().mockResolvedValue({});
    renderView({
      getExceptions: async () => ({
        ...EMPTY_EXCEPTIONS,
        documents_manquants: [{
          lot_id: 'lot-1', lot_name: 'Lot Sans Preuve', asset_name: 'Résidence', program_name: 'Programme',
          label: 'Aucune preuve pour « Fondations »', work_declaration_id: 'declaration-1',
        }],
      }),
      addEvidenceDocument,
    });

    const file = new File(['contenu'], 'preuve.jpg', { type: 'image/jpeg' });
    const input = await screen.findByLabelText('Ajouter une preuve pour Lot Sans Preuve');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une preuve' }));

    await waitFor(() => expect(addEvidenceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ workDeclarationId: 'declaration-1', file }),
    ));
  });
});

describe('ExceptionsView — doublon signalé à l\'upload (ticket F-052)', () => {
  const MISSING_DOCUMENT_EXCEPTIONS: ExceptionsPayload = {
    ...EMPTY_EXCEPTIONS,
    documents_manquants: [{
      lot_id: 'lot-1', lot_name: 'Lot Sans Preuve', asset_name: 'Résidence', program_name: 'Programme',
      label: 'Aucune preuve pour « Fondations »', work_declaration_id: 'declaration-1',
    }],
  };

  it('affiche un avertissement et ne recharge pas la liste tant que non confirmé', async () => {
    const getExceptions = vi.fn().mockResolvedValue(MISSING_DOCUMENT_EXCEPTIONS);
    const addEvidenceDocument = vi.fn().mockResolvedValue({ duplicateOf: 'document-original' });
    renderView({ getExceptions, addEvidenceDocument });

    const file = new File(['contenu'], 'preuve.jpg', { type: 'image/jpeg' });
    const input = await screen.findByLabelText('Ajouter une preuve pour Lot Sans Preuve');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une preuve' }));

    expect(await screen.findByText(/identique à un document déjà existant/i)).toBeInTheDocument();
    // La ligne reste affichée — pas de rechargement automatique de la liste.
    expect(getExceptions).toHaveBeenCalledTimes(1);
  });

  it('recharge la liste seulement au clic sur "Continuer"', async () => {
    const getExceptions = vi.fn().mockResolvedValue(MISSING_DOCUMENT_EXCEPTIONS);
    const addEvidenceDocument = vi.fn().mockResolvedValue({ duplicateOf: 'document-original' });
    renderView({ getExceptions, addEvidenceDocument });

    const file = new File(['contenu'], 'preuve.jpg', { type: 'image/jpeg' });
    const input = await screen.findByLabelText('Ajouter une preuve pour Lot Sans Preuve');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une preuve' }));
    await screen.findByText(/identique à un document déjà existant/i);

    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));

    await waitFor(() => expect(getExceptions).toHaveBeenCalledTimes(2));
  });

  it('sans doublon, aucun bandeau n\'apparaît (comportement inchangé)', async () => {
    const addEvidenceDocument = vi.fn().mockResolvedValue({ duplicateOf: null });
    renderView({
      getExceptions: async () => MISSING_DOCUMENT_EXCEPTIONS,
      addEvidenceDocument,
    });

    const file = new File(['contenu'], 'preuve.jpg', { type: 'image/jpeg' });
    const input = await screen.findByLabelText('Ajouter une preuve pour Lot Sans Preuve');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une preuve' }));

    await waitFor(() => expect(addEvidenceDocument).toHaveBeenCalled());
    expect(screen.queryByText(/identique à un document déjà existant/i)).not.toBeInTheDocument();
  });
});

describe('ExceptionsView — erreur de chargement générique (ticket F-033, vague 3)', () => {
  it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement', async () => {
    const getExceptions = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(EMPTY_EXCEPTIONS);
    renderView({ getExceptions });

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await screen.findByText('Aucune exception en ce moment — tout est à jour.');
    expect(getExceptions).toHaveBeenCalledTimes(2);
  });
});
