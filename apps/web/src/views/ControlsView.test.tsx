import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { ControlToAssign, InspectorSummary } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { ControlsView } from './ControlsView';

function control(overrides: Partial<ControlToAssign> = {}): ControlToAssign {
  return {
    organization: { id: 'org-promoteur', name: 'Promoteur Démonstration' },
    program: { id: 'program-1', name: 'Résidence Démonstration Abidjan' },
    lot: { id: 'lot-1', name: 'Lot A1' },
    milestone: { id: 'milestone-1', code: 'fondations', label: 'Fondations' },
    work_declaration_id: 'declaration-1',
    declared_at: '2026-09-28T09:00:00Z',
    status: 'awaiting_control',
    status_label: 'En attente de contrôle',
    evidence_count: 1,
    latest_outcome: null,
    correction_submitted: false,
    pending_mission: null,
    ...overrides,
  };
}

const INSPECTOR: InspectorSummary = {
  id: 'inspector-1', email: 'inspecteur.demo@keya.test', full_name: 'Bureau de contrôle (démo)',
  organizations: ['Bureau de contrôle Démonstration'],
};

function renderView(controls: ControlToAssign[], overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    listControlsToAssign: vi.fn().mockResolvedValue(controls),
    listInspectors: vi.fn().mockResolvedValue([INSPECTOR]),
    ...overrides,
  });
  render(withApiClient(api, <ControlsView />));
  return { api };
}

describe('ControlsView — contrôles à affecter (ticket F-069)', () => {
  it('missionne le contrôleur choisi sur la déclaration, avec l’organisation contrôlée', async () => {
    const assignMission = vi.fn().mockResolvedValue({});
    renderView([control()], { assignMission });

    fireEvent.click(await screen.findByRole('button', { name: 'Missionner' }));

    await waitFor(() => expect(assignMission).toHaveBeenCalledWith('org-promoteur', 'declaration-1', 'inspector-1'));
  });

  it('une mission en cours remplace le formulaire', async () => {
    renderView([control({
      pending_mission: { id: 'mission-1', inspector_email: 'inspecteur.demo@keya.test', assigned_at: '2026-09-28T10:00:00Z' },
    })]);

    expect(await screen.findByTestId('control-mission')).toHaveTextContent('Mission en cours : inspecteur.demo@keya.test');
    expect(screen.queryByRole('button', { name: 'Missionner' })).not.toBeInTheDocument();
  });

  it('sous réserve : indique si la correction est proposée', async () => {
    renderView([control({ status: 'under_reserve', status_label: 'Sous réserve', correction_submitted: true })]);

    expect(await screen.findByText('Proposée par le constructeur')).toBeInTheDocument();
  });

  it('un refus (règle d’indépendance) est affiché tel quel', async () => {
    const assignMission = vi.fn().mockRejectedValue(new ApiError(
      403, 'forbidden', "L'inspecteur assigné ne peut pas appartenir à l'organisation cible (règle d'indépendance du contrôle).",
    ));
    renderView([control()], { assignMission });

    fireEvent.click(await screen.findByRole('button', { name: 'Missionner' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("règle d'indépendance");
  });

  it('état vide explicite', async () => {
    renderView([]);
    expect(await screen.findByText('Aucune déclaration en attente de contrôle.')).toBeInTheDocument();
  });
});

describe('ControlsView — chiffres clés (ticket F-078)', () => {
  it('distingue les contrôles à missionner, les missions en cours et les réserves', async () => {
    renderView([
      control(),
      control({
        work_declaration_id: 'declaration-2',
        pending_mission: {
          id: 'mission-1', inspector_email: 'inspecteur.demo@keya.test', assigned_at: '2026-09-28T10:00:00Z',
        } as ControlToAssign['pending_mission'],
      }),
      control({ work_declaration_id: 'declaration-3', status: 'under_reserve', status_label: 'Sous réserve' }),
    ]);

    expect(await screen.findByTestId('kf-to-assign-value')).toHaveTextContent('2');
    expect(screen.getByTestId('kf-in-progress-value')).toHaveTextContent('1');
    expect(screen.getByTestId('kf-under-reserve-value')).toHaveTextContent('1');
  });
});
