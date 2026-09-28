import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Adapté selon PO-2026-09-28-22 : personnes « organisation · rôle », client par son nom, jamais d'e-mail.
import { ApiError } from '../api/client';
import type { AdminReservation, ContractVersion } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { AdminContractPanel } from './AdminContractPanel';

// Libellé « signée (simulé) » : adapté selon PO-2026-09-28-06.

const RESERVATION: AdminReservation = {
  id: 'reservation-1',
  status: 'held',
  status_label: 'Bloquée',
  held_until: '2026-09-28T14:30:00Z',
  price_amount: '30000000.00',
  currency: 'XOF',
  lot: { id: 'lot-1', name: 'Lot A12', surface: '82.00' },
  program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
  organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
  client: { id: 'client-1', full_name: 'Client', role: 'Client' },
  cancellation_reason: '',
  cancelled_by: null,
  created_at: '2026-09-27T14:30:00Z',
  updated_at: '2026-09-27T14:30:00Z',
};

function contract(overrides: Partial<ContractVersion> = {}): ContractVersion {
  return {
    id: 'contract-1',
    reservation: 'reservation-1',
    lot_name: 'Lot A12',
    version: 1,
    status: 'draft',
    status_label: 'Brouillon',
    content: 'Contrat v1',
    authored_by: 'adv@example.com',
    submitted_at: null,
    approved_by: null,
    approved_at: null,
    signed_at: null,
    simulation: true,
    created_at: '2026-09-27T09:00:00Z',
    updated_at: '2026-09-27T09:00:00Z',
    ...overrides,
  };
}

function renderPanel(overrides: Parameters<typeof createMockApiClient>[0] = {}, reservation = RESERVATION) {
  const api = createMockApiClient({ listContracts: vi.fn().mockResolvedValue([]), ...overrides });
  render(withApiClient(api, <AdminContractPanel reservation={reservation} />));
  return { api };
}

describe('AdminContractPanel — contrat fictif côté équipe KEYIMMO (ticket F-067, partie 2)', () => {
  it('sans version : rédaction d\'un premier brouillon avec l\'organisation de la réservation', async () => {
    const createContract = vi.fn().mockResolvedValue(contract());
    const { api } = renderPanel({ createContract });

    expect(await screen.findByText('Aucune version rédigée.')).toBeInTheDocument();
    expect(api.listContracts).toHaveBeenCalledWith('reservation-1', 'org-promoteur');
    fireEvent.change(screen.getByLabelText('Contenu du contrat'), { target: { value: 'Contrat v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer le brouillon' }));

    await waitFor(() => expect(createContract).toHaveBeenCalledWith('reservation-1', 'org-promoteur', 'Contrat v1'));
  });

  it('un brouillon se modifie et se soumet ; aucun nouveau brouillon tant qu\'une version est en cours', async () => {
    const updateContract = vi.fn().mockResolvedValue(contract({ content: 'Contrat v1 corrigé' }));
    const transitionContract = vi.fn().mockResolvedValue(contract({ status: 'review' }));
    renderPanel({ listContracts: vi.fn().mockResolvedValue([contract()]), updateContract, transitionContract });

    const form = await screen.findByRole('form', { name: 'Modifier la version 1' });
    expect(screen.queryByRole('form', { name: /Nouvelle version/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Contenu du contrat'), { target: { value: 'Contrat v1 corrigé' } });
    fireEvent.submit(form);
    await waitFor(() => expect(updateContract).toHaveBeenCalledWith('contract-1', 'org-promoteur', 'Contrat v1 corrigé'));

    fireEvent.click(screen.getByRole('button', { name: 'Soumettre pour revue' }));
    await waitFor(() => expect(transitionContract).toHaveBeenCalledWith('contract-1', 'org-promoteur', 'submit'));
  });

  it('une version en revue est figée : approuver ou revenir en brouillon, jamais modifier', async () => {
    const transitionContract = vi.fn().mockResolvedValue(contract({ status: 'approved' }));
    renderPanel({
      listContracts: vi.fn().mockResolvedValue([contract({ status: 'review', status_label: 'En revue' })]),
      transitionContract,
    });

    await screen.findByRole('button', { name: 'Approuver le contenu' });
    expect(screen.queryByLabelText('Contenu du contrat')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revenir en brouillon' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approuver le contenu' }));

    await waitFor(() => expect(transitionContract).toHaveBeenCalledWith('contract-1', 'org-promoteur', 'approve'));
  });

  it('après signature : version figée, nouvelle version proposée pré-remplie avec la précédente (T04)', async () => {
    renderPanel({
      listContracts: vi.fn().mockResolvedValue([contract({
        status: 'signed_simulated', status_label: 'Signé (simulation)', signed_at: '2026-09-27T12:00:00Z',
        approved_at: '2026-09-27T11:00:00Z', approved_by: 'adv@example.com',
      })]),
    });

    const version = await screen.findByRole('article', { name: 'Version 1' });
    expect(version).toHaveTextContent('SIMULÉ — SANS VALEUR OPÉRATIONNELLE');
    expect(version).toHaveTextContent('signée par le client (simulé) le 27 sept. 2026, 12:00 (GMT, Abidjan)'); // Audit UI R1 (F06)
    // Repliée derrière un bouton explicite, jamais ouverte d'office.
    expect(screen.queryByRole('form', { name: 'Nouvelle version (v2)' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Corriger : créer une nouvelle version' }));
    expect(screen.getByRole('form', { name: 'Nouvelle version (v2)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Contenu du contrat')).toHaveValue('Contrat v1');
  });

  it('corriger une version en attente de signature avertit qu\'elle ne sera plus signable', async () => {
    renderPanel({
      listContracts: vi.fn().mockResolvedValue([contract({ status: 'approved', status_label: 'Approuvé' })]),
    });

    expect(await screen.findByText('En attente de la signature simulée du client.')).toBeInTheDocument();
    expect(screen.getByText('La version 1, en attente de signature, ne sera alors plus signable.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Contenu du contrat')).not.toBeInTheDocument();
  });

  it('une version approuvée remplacée par une plus récente est signalée comme non signable', async () => {
    renderPanel({
      listContracts: vi.fn().mockResolvedValue([
        contract({ id: 'c1', version: 1, status: 'approved', status_label: 'Approuvé' }),
        contract({ id: 'c2', version: 2, status: 'draft' }),
      ]),
    });

    expect(await screen.findByText(/n'est plus signable/)).toBeInTheDocument();
    const versions = screen.getAllByRole('article');
    expect(versions.map((node) => node.getAttribute('aria-label'))).toEqual(['Version 2', 'Version 1']);
  });

  it('réservation expirée : historique consultable, aucune création possible', async () => {
    renderPanel(
      { listContracts: vi.fn().mockResolvedValue([contract({ status: 'approved', status_label: 'Approuvé' })]) },
      { ...RESERVATION, status: 'expired', status_label: 'Expirée' },
    );

    expect(await screen.findByRole('article', { name: 'Version 1' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /Nouvelle version/ })).not.toBeInTheDocument();
  });

  it('un refus du serveur est affiché tel quel', async () => {
    const transitionContract = vi.fn().mockRejectedValue(
      new ApiError(409, 'conflict', 'Cette réservation est expirée ou annulée.'),
    );
    renderPanel({ listContracts: vi.fn().mockResolvedValue([contract()]), transitionContract });

    fireEvent.click(await screen.findByRole('button', { name: 'Soumettre pour revue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cette réservation est expirée ou annulée.');
  });
});
