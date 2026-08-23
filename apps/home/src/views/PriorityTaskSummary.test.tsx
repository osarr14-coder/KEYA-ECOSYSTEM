import { brandColors, semanticColors } from '@keya/design-system';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { PriorityTaskSummary } from './PriorityTaskSummary';

describe('PriorityTaskSummary — consomme le même endpoint que Mes actions', () => {
  it('appelle getMyTasks avec status=pending et ordering=priority (pas de tri local)', async () => {
    const getMyTasks = vi.fn(async () => []);
    const api = createMockApiClient({ getMyTasks });

    render(withApiClient(api, <PriorityTaskSummary onSeeAllActions={() => {}} activeOrganizationId={null} />));

    await screen.findByText("Rien à faire pour l'instant.");
    expect(getMyTasks).toHaveBeenCalledWith({ status: 'pending', ordering: 'priority' });
  });

  it('affiche le titre et l\'échéance de la première tâche reçue (déjà triée par le backend)', async () => {
    const api = createMockApiClient({
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'x',
          program: null, assignee: 'client@example.com', source: 'reserve_opened',
          label: 'Réserve ouverte sur le lot « Lot 12 »', due_date: '2026-04-01T00:00:00Z',
          priority: 'high' as const, status: 'pending' as const,
          created_at: '2026-03-06T09:00:00Z', completed_at: null,
        },
        {
          id: 'task-2', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'y',
          program: null, assignee: 'client@example.com', source: 'test_fixture',
          label: 'Tâche moins prioritaire', due_date: null,
          priority: 'low' as const, status: 'pending' as const,
          created_at: '2026-03-05T09:00:00Z', completed_at: null,
        },
      ],
    });

    render(withApiClient(api, <PriorityTaskSummary onSeeAllActions={() => {}} activeOrganizationId={null} />));

    expect(await screen.findByText('Réserve ouverte sur le lot « Lot 12 »')).toBeInTheDocument();
    expect(screen.getByText('Échéance : 01/04/2026')).toBeInTheDocument();
    // La seconde tâche (moins prioritaire) n'est PAS affichée — un simple
    // résumé, pas la liste complète (détail laissé à "Mes actions").
    expect(screen.queryByText('Tâche moins prioritaire')).not.toBeInTheDocument();
  });

  it('affiche "Aucune échéance" quand due_date est absent', async () => {
    const api = createMockApiClient({
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'x',
          program: null, assignee: 'client@example.com', source: 'reserve_opened',
          label: 'Action sans échéance', due_date: null,
          priority: 'normal' as const, status: 'pending' as const,
          created_at: '2026-03-06T09:00:00Z', completed_at: null,
        },
      ],
    });

    render(withApiClient(api, <PriorityTaskSummary onSeeAllActions={() => {}} activeOrganizationId={null} />));

    expect(await screen.findByText('Échéance : Aucune échéance')).toBeInTheDocument();
  });

  it('affiche un état vide explicite quand aucune tâche n\'est en attente', async () => {
    const api = createMockApiClient({ getMyTasks: async () => [] });

    render(withApiClient(api, <PriorityTaskSummary onSeeAllActions={() => {}} activeOrganizationId={null} />));

    expect(await screen.findByText("Rien à faire pour l'instant.")).toBeInTheDocument();
  });

  it('le lien "Voir toutes mes actions" déclenche la bascule vers l\'onglet Mes actions', async () => {
    const onSeeAllActions = vi.fn();
    const api = createMockApiClient({
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'x',
          program: null, assignee: 'client@example.com', source: 'reserve_opened',
          label: 'Action prioritaire', due_date: null,
          priority: 'high' as const, status: 'pending' as const,
          created_at: '2026-03-06T09:00:00Z', completed_at: null,
        },
      ],
    });

    render(withApiClient(api, <PriorityTaskSummary onSeeAllActions={onSeeAllActions} activeOrganizationId={null} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Voir toutes mes actions' }));
    expect(onSeeAllActions).toHaveBeenCalledOnce();
  });

  it('le CTA "Voir toutes mes actions" est en navy plein, texte blanc (ticket F-046)', async () => {
    const api = createMockApiClient({
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'x',
          program: null, assignee: 'client@example.com', source: 'reserve_opened',
          label: 'Action prioritaire', due_date: null,
          priority: 'high' as const, status: 'pending' as const,
          created_at: '2026-03-06T09:00:00Z', completed_at: null,
        },
      ],
    });

    render(withApiClient(api, <PriorityTaskSummary onSeeAllActions={() => {}} activeOrganizationId={null} />));

    const button = await screen.findByRole('button', { name: 'Voir toutes mes actions' });
    // Ticket F-051 — `color: semanticColors.neutral.surface` (PAS un
    // `#FFFFFF` figé) : `Button` (variante primary, design-system) fournit
    // ce texte, déjà corrigé pour le mode sombre — voir Button.tsx. En
    // clair, `neutral.surface` VAUT `#FFFFFF` (comportement inchangé),
    // mais ce n'est plus la même VALEUR DE TOKEN qu'avant ce ticket.
    expect(button).toHaveStyle({ background: brandColors.navy, color: semanticColors.neutral.surface });
  });

  it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement (ticket F-033)', async () => {
    const getMyTasks = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);
    const api = createMockApiClient({ getMyTasks });

    render(withApiClient(api, <PriorityTaskSummary onSeeAllActions={() => {}} activeOrganizationId={null} />));

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await screen.findByText("Rien à faire pour l'instant.");
    expect(getMyTasks).toHaveBeenCalledTimes(2);
  });
});
