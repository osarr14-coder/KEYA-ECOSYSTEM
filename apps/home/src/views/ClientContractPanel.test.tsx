import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { ContractVersion } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { createMockApiClient, withApiClient } from '../testUtils';
import { ContractVersions } from './ClientContractPanel';

// Libellés « Signer (simulé) » / « signée (simulé) » : adaptés selon PO-2026-09-28-06.

/** Ticket F-074 — même flux de données que `AcquisitionJourney` : chargement
 * des versions, rendu présentationnel, rechargement après signature. */
function ClientContractPanel({ reservationId }: { reservationId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyContracts(reservationId), [reservationId]);
  if (state.status !== 'success') return null;
  return <ContractVersions contracts={state.data} onSigned={state.refetch} />;
}

function contract(overrides: Partial<ContractVersion> = {}): ContractVersion {
  return {
    id: 'contract-1',
    reservation: 'reservation-1',
    lot_name: 'Lot A12',
    version: 1,
    status: 'approved',
    status_label: 'Approuvé',
    content: 'Contrat de réservation fictif.\nPrix : 30 000 000 XOF.',
    authored_by: 'adv@example.com',
    submitted_at: '2026-09-27T10:00:00Z',
    approved_by: 'adv@example.com',
    approved_at: '2026-09-27T11:00:00Z',
    signed_at: null,
    simulation: true,
    created_at: '2026-09-27T09:00:00Z',
    updated_at: '2026-09-27T11:00:00Z',
    ...overrides,
  };
}

function renderPanel(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({ getMyContracts: vi.fn().mockResolvedValue([contract()]), ...overrides });
  render(withApiClient(api, <ClientContractPanel reservationId="reservation-1" />));
  return { api };
}

describe('ClientContractPanel — contrat fictif côté client (ticket F-066, partie 2)', () => {
  it('sans version visible : le contrat est annoncé en préparation', async () => {
    renderPanel({ getMyContracts: vi.fn().mockResolvedValue([]) });
    expect(await screen.findByText('Contrat : en cours de préparation par le gestionnaire.')).toBeInTheDocument();
  });

  it('affiche le contenu, la date d\'approbation et le marquage de simulation (CDC §3.1)', async () => {
    renderPanel();

    const version = await screen.findByRole('article', { name: 'Contrat version 1' });
    expect(version).toHaveTextContent('SIMULÉ — SANS VALEUR OPÉRATIONNELLE');
    expect(version).toHaveTextContent('DÉMONSTRATION — DONNÉES FICTIVES');
    expect(version).toHaveTextContent('Prix : 30 000 000 XOF.');
    expect(version).toHaveTextContent('approuvée le 27 sept. 2026, 11:00 (GMT, Abidjan)'); // Audit UI R1 (F06)
  });

  it('la signature exige une lecture reconnue, puis appelle le serveur et rafraîchit', async () => {
    const signContract = vi.fn().mockResolvedValue(contract({ status: 'signed_simulated' }));
    const getMyContracts = vi.fn()
      .mockResolvedValueOnce([contract()])
      .mockResolvedValue([contract({
        status: 'signed_simulated', status_label: 'Signé (simulation)', signed_at: '2026-09-27T12:00:00Z',
      })]);
    renderPanel({ signContract, getMyContracts });

    const button = await screen.findByRole('button', { name: 'Signer (simulé)' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);

    await waitFor(() => expect(signContract).toHaveBeenCalledWith('contract-1'));
    // Audit UI R1 (F06) : format de date unique.
    expect(await screen.findByText(/signée \(simulé\) le 27 sept\. 2026, 12:00 \(GMT, Abidjan\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Signer (simulé)' })).not.toBeInTheDocument();
  });

  it('les versions sont listées de la plus récente à la plus ancienne', async () => {
    renderPanel({
      getMyContracts: vi.fn().mockResolvedValue([
        contract({ id: 'c1', version: 1, status: 'signed_simulated', status_label: 'Signé (simulation)' }),
        contract({ id: 'c2', version: 2 }),
      ]),
    });

    const versions = await screen.findAllByRole('article');
    expect(versions.map((node) => node.getAttribute('aria-label'))).toEqual(['Contrat version 2', 'Contrat version 1']);
  });

  it('un refus du serveur (version plus récente, réservation expirée) est affiché tel quel', async () => {
    const signContract = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', {
      detail: 'Une version plus récente de ce contrat existe : seule la dernière version peut être signée.',
    }));
    renderPanel({ signContract });

    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Signer (simulé)' }));

    expect(await screen.findByText(/seule la dernière version peut être signée/)).toBeInTheDocument();
  });
});
