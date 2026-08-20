import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { OverviewView } from './OverviewView';

const NO_PENDING_TASKS = async () => [];

describe('OverviewView — aucun calcul côté frontend (critère d\'acceptation)', () => {
  it('affiche exactement le pourcentage renvoyé par l\'API, sans le recalculer', async () => {
    // 37 n'est atteignable par aucune formule "ronde" plausible côté
    // frontend (pas 0/25/50/75/100) — si le composant affichait autre chose
    // que 37, ce serait la preuve d'une transformation locale, pas un
    // simple passthrough.
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Almadies, Dakar', program_name: 'Programme Keur Massar',
        progress_percentage: 37, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
      getMyTasks: NO_PENDING_TASKS,
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={() => {}} activeOrganizationId={null} />));

    expect(await screen.findByText('37% d\'avancement')).toBeInTheDocument();
  });

  it('affiche le hero du bien tel que reçu (nom, programme, lot, localisation)', async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Almadies, Dakar', program_name: 'Programme Keur Massar',
        progress_percentage: 0, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
      getMyTasks: NO_PENDING_TASKS,
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={() => {}} activeOrganizationId={null} />));

    const hero = await screen.findByTestId('hero');
    expect(hero).toHaveTextContent('Résidence Ker');
    expect(hero).toHaveTextContent('Programme Keur Massar');
    expect(hero).toHaveTextContent('Lot 12');
    expect(hero).toHaveTextContent('Almadies, Dakar');
  });

  it('affiche le dernier événement notable via StatusBadge, avec les données reçues', async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 40, milestones: [],
        latest_notable_event: {
          level: 'documente', source: 'evidence_upload', actor: 'constructeur@example.com',
          scope: '', created_at: '2026-03-05T10:30:00Z',
        },
        open_reserve: null,
      }),
      getMyTasks: NO_PENDING_TASKS,
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={() => {}} activeOrganizationId={null} />));

    expect(await screen.findByText('Documenté')).toBeInTheDocument();
    // Popover fermé par défaut — seul le libellé du badge est visible avant clic.
    expect(screen.queryByText('constructeur@example.com')).not.toBeInTheDocument();
  });

  it("affiche une réserve ouverte comme problème principal, avec le style d'alerte du design system", async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 60, milestones: [], latest_notable_event: null,
        open_reserve: { id: 'reserve-1', status: 'ouverte', description: 'Fissure en façade' },
      }),
      getMyTasks: NO_PENDING_TASKS,
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={() => {}} activeOrganizationId={null} />));

    const problem = await screen.findByTestId('open-reserve');
    expect(problem).toHaveTextContent('Réserve ouverte');
    expect(problem).toHaveTextContent('Fissure en façade');
    // AlertBanner (ticket 007/008) : role="alert" + icône visuelle, pas
    // seulement du texte en gras — c'est ce qui doit le faire ressortir
    // sans lecture attentive.
    expect(problem.querySelector('[role="alert"]')).not.toBeNull();
    expect(problem.querySelector('svg')).not.toBeNull();
  });

  it("n'affiche aucun bloc problème quand il n'y a pas de réserve ouverte", async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 60, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
      getMyTasks: NO_PENDING_TASKS,
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={() => {}} activeOrganizationId={null} />));

    await screen.findByText("60% d'avancement");
    expect(screen.queryByTestId('open-reserve')).not.toBeInTheDocument();
  });

  it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement (ticket F-033)', async () => {
    const getLotOverview = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 60, milestones: [], latest_notable_event: null, open_reserve: null,
      });
    const api = createMockApiClient({ getLotOverview, getMyTasks: NO_PENDING_TASKS });

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={() => {}} activeOrganizationId={null} />));

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await screen.findByText("60% d'avancement");
    expect(getLotOverview).toHaveBeenCalledTimes(2);
  });
});

describe('OverviewView — résumé de la tâche prioritaire (« prochaine action »)', () => {
  it('affiche la tâche prioritaire renvoyée par le même endpoint que Mes actions', async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 0, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
      getMyTasks: async () => [
        {
          id: 'task-1', type: 'task' as const, subject_type: 'inbox_tasks.task', subject_id: 'x',
          program: null, assignee: 'client@example.com', source: 'reserve_opened',
          label: 'Action à traiter en priorité', due_date: '2026-04-01T00:00:00Z',
          priority: 'high' as const, status: 'pending' as const,
          created_at: '2026-03-06T09:00:00Z', completed_at: null,
        },
      ],
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={() => {}} activeOrganizationId={null} />));

    expect(await screen.findByText('Action à traiter en priorité')).toBeInTheDocument();
  });

  it("affiche un état vide explicite quand aucune tâche n'est en attente", async () => {
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 0, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
      getMyTasks: NO_PENDING_TASKS,
    });

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={() => {}} activeOrganizationId={null} />));

    expect(await screen.findByText("Rien à faire pour l'instant.")).toBeInTheDocument();
  });

  it('transmet onSeeAllActions au résumé, pour basculer vers l\'onglet Mes actions', async () => {
    const onSeeAllActions = vi.fn();
    const api = createMockApiClient({
      getLotOverview: async () => ({
        lot_id: 'lot-1', lot_name: 'Lot 12', asset_name: 'Résidence Ker',
        asset_location: 'Dakar', program_name: 'Programme',
        progress_percentage: 0, milestones: [], latest_notable_event: null, open_reserve: null,
      }),
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

    render(withApiClient(api, <OverviewView lotId="lot-1" onSeeAllActions={onSeeAllActions} activeOrganizationId={null} />));

    const button = await screen.findByRole('button', { name: 'Voir toutes mes actions' });
    button.click();
    expect(onSeeAllActions).toHaveBeenCalledOnce();
  });
});
