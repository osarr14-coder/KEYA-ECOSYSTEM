import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { ProgramRequestsView } from './ProgramRequestsView';

const REQUEST = {
  id: 'req-1', organization: 'org-1', organization_name: 'Compte personnel — sponsor@example.com',
  requested_by: 'user-1', requested_by_email: 'sponsor@example.com',
  description: 'Villa 4 pièces à Dakar, budget 60M FCFA.',
  status: 'en_attente' as const, program: null, created_at: '2026-03-06T09:00:00Z',
};

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    listProgramRequests: async () => [],
    ...overrides,
  });
  return { api, ...render(withApiClient(api, <ProgramRequestsView />)) };
}

describe('ProgramRequestsView', () => {
  it('charge le filtre "En attente" par défaut', async () => {
    const listProgramRequests = vi.fn().mockResolvedValue([]);
    renderView({ listProgramRequests });

    await waitFor(() => expect(listProgramRequests).toHaveBeenCalledWith('en_attente'));
  });

  it("affiche un message quand aucune demande ne correspond au filtre", async () => {
    renderView();
    expect(await screen.findByTestId('no-requests')).toBeInTheDocument();
  });

  it('affiche les demandes avec organisation, email, description et statut', async () => {
    renderView({ listProgramRequests: async () => [REQUEST] });

    expect(await screen.findByText(REQUEST.organization_name)).toBeInTheDocument();
    expect(screen.getByText(REQUEST.description)).toBeInTheDocument();
    expect(screen.getByTestId('request-meta')).toHaveTextContent(REQUEST.requested_by_email);
    expect(screen.getByTestId('request-status')).toHaveTextContent('En attente');
  });

  it('changer le filtre relance le chargement avec le nouveau statut', async () => {
    const listProgramRequests = vi.fn().mockResolvedValue([]);
    renderView({ listProgramRequests });

    await waitFor(() => expect(listProgramRequests).toHaveBeenCalledWith('en_attente'));
    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'acceptee' } });

    await waitFor(() => expect(listProgramRequests).toHaveBeenCalledWith('acceptee'));
  });

  it("le filtre « Toutes » n'envoie aucun paramètre de statut", async () => {
    const listProgramRequests = vi.fn().mockResolvedValue([]);
    renderView({ listProgramRequests });

    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: '' } });

    await waitFor(() => expect(listProgramRequests).toHaveBeenCalledWith(undefined));
  });

  it('accepter une demande appelle decideProgramRequest puis recharge la liste', async () => {
    const decideProgramRequest = vi.fn().mockResolvedValue({ ...REQUEST, status: 'acceptee' });
    const listProgramRequests = vi.fn()
      .mockResolvedValueOnce([REQUEST])
      .mockResolvedValueOnce([{ ...REQUEST, status: 'acceptee' as const }]);
    renderView({ decideProgramRequest, listProgramRequests });

    await screen.findByText(REQUEST.description);
    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }));

    await waitFor(() => expect(decideProgramRequest).toHaveBeenCalledWith(REQUEST.id, REQUEST.organization, 'acceptee'));
    expect(await screen.findByTestId('request-status')).toHaveTextContent('Acceptée');
  });

  it('refuser une demande appelle decideProgramRequest avec "refusee"', async () => {
    const decideProgramRequest = vi.fn().mockResolvedValue({ ...REQUEST, status: 'refusee' });
    renderView({ decideProgramRequest, listProgramRequests: async () => [REQUEST] });

    await screen.findByText(REQUEST.description);
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));

    await waitFor(() => expect(decideProgramRequest).toHaveBeenCalledWith(REQUEST.id, REQUEST.organization, 'refusee'));
  });

  it('une demande déjà acceptée ou refusée ne montre plus les boutons de décision', async () => {
    renderView({ listProgramRequests: async () => [{ ...REQUEST, status: 'acceptee' as const }] });

    await screen.findByText(REQUEST.description);
    expect(screen.queryByRole('button', { name: 'Accepter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refuser' })).not.toBeInTheDocument();
  });

  it('une demande acceptée sans programme rappelle de le créer via l\'onglet Programmes', async () => {
    renderView({ listProgramRequests: async () => [{ ...REQUEST, status: 'acceptee' as const }] });

    expect(await screen.findByText(/créez le programme depuis l.onglet/i)).toBeInTheDocument();
  });

  it('un échec de décision affiche une erreur locale', async () => {
    const decideProgramRequest = vi.fn().mockRejectedValue(new Error('boom'));
    renderView({ decideProgramRequest, listProgramRequests: async () => [REQUEST] });

    await screen.findByText(REQUEST.description);
    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }));

    expect(await screen.findByText('Échec de la décision.')).toBeInTheDocument();
  });

  it('affiche une erreur de chargement avec un bouton Réessayer', async () => {
    const listProgramRequests = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);
    renderView({ listProgramRequests });

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => expect(listProgramRequests).toHaveBeenCalledTimes(2));
  });
});
