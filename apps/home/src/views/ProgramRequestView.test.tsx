import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { ProgramRequestView } from './ProgramRequestView';

const REQUEST = {
  id: 'req-1', organization: 'org-1', organization_name: 'Compte personnel — sponsor@example.com',
  requested_by: 'user-1', requested_by_email: 'sponsor@example.com',
  description: 'Villa 4 pièces à Dakar, budget 60M FCFA.',
  status: 'en_attente' as const, program: null, created_at: '2026-03-06T09:00:00Z',
};

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getMyProgramRequests: async () => [],
    getMyTasks: async () => [],
    ...overrides,
  });
  return { api, ...render(withApiClient(api, <ProgramRequestView />)) };
}

describe('ProgramRequestView', () => {
  it('affiche le formulaire de soumission dès le premier rendu', async () => {
    renderView();
    expect(await screen.findByRole('form', { name: 'Soumettre une demande de programme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoyer ma demande' })).toBeDisabled();
  });

  it('le bouton est désactivé tant que la description est vide', async () => {
    renderView();
    const textarea = await screen.findByLabelText('Type de bien souhaité, localisation, budget indicatif…');
    const button = screen.getByRole('button', { name: 'Envoyer ma demande' });

    fireEvent.change(textarea, { target: { value: 'Un projet' } });
    expect(button).not.toBeDisabled();

    fireEvent.change(textarea, { target: { value: '' } });
    expect(button).toBeDisabled();
  });

  it('soumettre le formulaire appelle createProgramRequest puis recharge la liste', async () => {
    const createProgramRequest = vi.fn().mockResolvedValue(REQUEST);
    const getMyProgramRequests = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([REQUEST]);
    renderView({ createProgramRequest, getMyProgramRequests });

    const textarea = await screen.findByLabelText('Type de bien souhaité, localisation, budget indicatif…');
    fireEvent.change(textarea, { target: { value: REQUEST.description } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));

    await waitFor(() => expect(createProgramRequest).toHaveBeenCalledWith(REQUEST.description));
    expect(await screen.findByText(REQUEST.description)).toBeInTheDocument();
    expect(getMyProgramRequests).toHaveBeenCalledTimes(2);
  });

  it('un échec de soumission affiche une erreur locale, sans perdre la saisie', async () => {
    const createProgramRequest = vi.fn().mockRejectedValue(new Error('boom'));
    renderView({ createProgramRequest });

    const textarea = await screen.findByLabelText('Type de bien souhaité, localisation, budget indicatif…');
    fireEvent.change(textarea, { target: { value: 'Un projet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));

    expect(await screen.findByText("Échec de l'envoi de la demande.")).toBeInTheDocument();
    expect(textarea).toHaveValue('Un projet');
  });

  it('affiche mes demandes existantes avec leur statut', async () => {
    renderView({ getMyProgramRequests: async () => [REQUEST] });

    expect(await screen.findByText(REQUEST.description)).toBeInTheDocument();
    const status = screen.getByTestId('request-status');
    expect(status).toHaveTextContent('En attente');
    expect(status).toHaveAttribute('data-status', 'en_attente');
  });

  it('une demande acceptée affiche le libellé "Acceptée"', async () => {
    renderView({ getMyProgramRequests: async () => [{ ...REQUEST, status: 'acceptee' as const }] });

    expect(await screen.findByTestId('request-status')).toHaveTextContent('Acceptée');
  });

  it("n'affiche pas la carte « Mes demandes » quand aucune demande n'existe encore", async () => {
    renderView({ getMyProgramRequests: async () => [] });

    await screen.findByRole('form', { name: 'Soumettre une demande de programme' });
    expect(screen.queryByText('Mes demandes')).not.toBeInTheDocument();
  });

  it('affiche une erreur de chargement avec un bouton Réessayer', async () => {
    const getMyProgramRequests = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);
    renderView({ getMyProgramRequests });

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => expect(getMyProgramRequests).toHaveBeenCalledTimes(2));
  });

  it('affiche une notification de décision en attente (ticket F-059)', async () => {
    const getMyTasks = vi.fn().mockResolvedValue([{
      id: 'task-1', type: 'notification' as const, subject_type: 'programrequest', subject_id: 'req-1',
      program: null, assignee: 'user-1', source: 'program_request_decided',
      label: 'Votre demande de programme sur mesure a été acceptée — KEYIMMO prépare la création de votre programme.',
      due_date: null, priority: 'normal' as const, status: 'pending' as const,
      created_at: '2026-03-10T09:00:00Z', completed_at: null,
    }]);
    renderView({ getMyTasks });

    expect(await screen.findByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText(/a été acceptée/)).toBeInTheDocument();
    expect(getMyTasks).toHaveBeenCalledWith({ type: 'notification', status: 'pending' });
  });

  it("n'affiche pas de carte Notifications sans notification en attente", async () => {
    renderView();

    await screen.findByRole('form', { name: 'Soumettre une demande de programme' });
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });
});
