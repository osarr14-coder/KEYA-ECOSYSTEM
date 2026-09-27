import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LotMilestone, LotRow } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { MilestonesView } from './MilestonesView';

const LOT: LotRow = {
  id: 'lot-1',
  name: 'Lot A1',
  asset_name: 'Bâtiment A',
  program_id: 'program-1',
  program_name: 'Résidence Démonstration Abidjan',
  assigned_organization_id: 'org-1',
  assigned_organization_name: 'Promoteur-constructeur',
  milestone_count: 8,
  declared_milestone_count: 0,
  progress_percentage: 0,
  open_reserve_count: 0,
  created_at: '2026-09-27T10:00:00Z',
};

function milestone(overrides: Partial<LotMilestone> = {}): LotMilestone {
  return {
    id: 'milestone-1',
    order: 3,
    code: 'fondations',
    label: 'Fondations',
    status: 'not_declared',
    status_label: 'Non déclaré',
    work_declaration_id: null,
    evidence_count: 0,
    latest_outcome: null,
    reserve_id: null,
    correction_submitted: false,
    control_scheduled: false,
    ...overrides,
  };
}

function renderView(milestones: LotMilestone[], overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getAllLots: vi.fn().mockResolvedValue({ count: 1, next: null, previous: null, results: [LOT] }),
    listLotMilestones: vi.fn().mockResolvedValue(milestones),
    ...overrides,
  });
  render(withApiClient(api, <MilestonesView activeOrganizationId="org-1" />));
  return { api };
}

const PDF = new File(['%PDF-1.4'], 'pv.pdf', { type: 'application/pdf' });

describe('MilestonesView — jalons côté constructeur (ticket F-069)', () => {
  it('déclare un jalon non déclaré', async () => {
    const declareMilestone = vi.fn().mockResolvedValue({ id: 'declaration-1' });
    const { api } = renderView([milestone()], { declareMilestone });

    fireEvent.click(await screen.findByRole('button', { name: 'Déclarer ce jalon' }));

    await waitFor(() => expect(declareMilestone).toHaveBeenCalledWith('milestone-1'));
    expect(api.listLotMilestones).toHaveBeenCalledWith('lot-1');
  });

  it('joint une pièce à une déclaration qui n’en a pas', async () => {
    const addEvidenceDocument = vi.fn().mockResolvedValue({ duplicateOf: null, evidenceId: 'evidence-1' });
    renderView([milestone({
      status: 'awaiting_documents', status_label: 'Déclaré — pièce à joindre', work_declaration_id: 'declaration-1',
    })], { addEvidenceDocument });

    fireEvent.change(await screen.findByLabelText('Pièce pour Fondations'), { target: { files: [PDF] } });
    fireEvent.click(screen.getByRole('button', { name: 'Joindre la pièce' }));

    await waitFor(() => expect(addEvidenceDocument).toHaveBeenCalledWith({
      workDeclarationId: 'declaration-1', file: PDF, category: 'preuve_chantier', source: 'control_tower_upload',
    }));
  });

  it('sous réserve : propose une correction rattachée à la nouvelle pièce, sans jamais lever la réserve', async () => {
    const addEvidenceDocument = vi.fn().mockResolvedValue({ duplicateOf: null, evidenceId: 'evidence-2' });
    const createReserveCorrection = vi.fn().mockResolvedValue({});
    renderView([milestone({
      status: 'under_reserve', status_label: 'Sous réserve', work_declaration_id: 'declaration-1',
      evidence_count: 1, reserve_id: 'reserve-1',
    })], { addEvidenceDocument, createReserveCorrection });

    fireEvent.change(await screen.findByLabelText('Correction pour Fondations'), { target: { files: [PDF] } });
    fireEvent.click(screen.getByRole('button', { name: 'Proposer la correction' }));

    await waitFor(() => expect(createReserveCorrection).toHaveBeenCalledWith('reserve-1', 'evidence-2'));
    expect(screen.queryByRole('button', { name: /lever/i })).not.toBeInTheDocument();
  });

  it('affiche l’état dérivé par le serveur (contrôle planifié, accepté)', async () => {
    renderView([
      milestone({
        status: 'awaiting_control', status_label: 'En attente de contrôle', work_declaration_id: 'd-1',
        evidence_count: 1, control_scheduled: true,
      }),
      milestone({ id: 'milestone-2', order: 4, code: 'gros_oeuvre', label: 'Gros œuvre', status: 'accepted', status_label: 'Accepté techniquement' }),
    ]);

    expect(await screen.findByTestId('milestone-status-fondations')).toHaveTextContent('En attente de contrôle');
    expect(screen.getByText('Le bureau de contrôle est missionné.')).toBeInTheDocument();
    expect(screen.getByTestId('milestone-status-gros_oeuvre')).toHaveTextContent('Accepté techniquement');
  });
});
