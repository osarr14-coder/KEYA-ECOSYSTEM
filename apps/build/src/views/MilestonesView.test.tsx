import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LotMilestone, LotRow } from '../api/types';
import { ApiError } from '../api/client';
import { createMockApiClient, withApiClient } from '../testUtils';
import { MilestonesView, focusMilestone } from './MilestonesView';

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
  accepted_milestone_count: 0,
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

  it('chantier non ouvert : pas de déclaration, motif du serveur affiché (PO-2026-09-29-09)', async () => {
    const hint = 'Chantier non ouvert : le dossier de ce lot n\'est pas encore concrétisé.';
    const declareMilestone = vi.fn();
    renderView([milestone({ chantier_open: false, chantier_hint: hint })], { declareMilestone });

    expect(await screen.findByTestId('chantier-closed')).toHaveTextContent(hint);
    expect(screen.queryByRole('button', { name: 'Déclarer ce jalon' })).not.toBeInTheDocument();
    expect(declareMilestone).not.toHaveBeenCalled();
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

  it('PO-2026-09-28-63/-64 : le constructeur désigne la pièce exigée ; la liste dit la présence, pas la conformité', async () => {
    const addEvidenceDocument = vi.fn().mockResolvedValue({ duplicateOf: null, evidenceId: 'evidence-2' });
    renderView([milestone({
      status: 'awaiting_control', status_label: 'Soumis', work_declaration_id: 'declaration-1', evidence_count: 1,
      required_pieces: [
        { code: 'plan_implantation', label: 'Plan d’implantation', deposited: true, deposited_at: '2026-09-28T10:00:00Z', examined: null },
        { code: 'photo_fouilles', label: 'Photo des fouilles', deposited: false, deposited_at: null, examined: null },
      ],
    })], { addEvidenceDocument });

    const pieces = await screen.findByTestId('required-pieces');
    expect(pieces).toHaveTextContent('Pièces exigées — 1 / 2 déposées');
    expect(pieces).toHaveTextContent('À déposer');
    expect(pieces).toHaveTextContent('pas conforme');
    const select = screen.getByLabelText('Pièce exigée — Pièce pour Fondations') as HTMLSelectElement;
    expect(select.value).toBe('photo_fouilles');  // première pièce manquante proposée
    expect(screen.getByRole('option', { name: 'Plan d’implantation (déjà déposée)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Autre pièce' })).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('Pièce pour Fondations'), { target: { files: [PDF] } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une pièce' }));

    await waitFor(() => expect(addEvidenceDocument).toHaveBeenCalledWith({
      workDeclarationId: 'declaration-1', file: PDF, category: 'preuve_chantier', source: 'control_tower_upload',
      requiredPiece: 'photo_fouilles',
    }));
  });

  it('vérification finale (T15) : un dépôt refusé affiche le message du serveur, pas le code HTTP', async () => {
    const addEvidenceDocument = vi.fn().mockRejectedValue(new ApiError(
      400, 'Échec de la requête /api/documents/ (400)', undefined,
      { file: ['Format de fichier non supporté — seuls PDF, JPEG et PNG sont acceptés.'] },
    ));
    renderView([milestone({
      status: 'awaiting_documents', status_label: 'Déclaré — pièce à joindre', work_declaration_id: 'declaration-1',
    })], { addEvidenceDocument });

    fireEvent.change(await screen.findByLabelText('Pièce pour Fondations'), { target: { files: [PDF] } });
    fireEvent.click(screen.getByRole('button', { name: 'Joindre la pièce' }));

    expect(await screen.findByText('Format de fichier non supporté — seuls PDF, JPEG et PNG sont acceptés.')).toBeInTheDocument();
    expect(screen.queryByText(/Échec de la requête/)).not.toBeInTheDocument();
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

  it('PO-2026-09-28-16 : chaque réserve ouverte (motif, action, date, auteur) est affichée au-dessus du formulaire de correction', async () => {
    renderView([milestone({
      status: 'under_reserve', status_label: 'Corrections demandées', cdc_state: 'CHANGES_REQUESTED',
      work_declaration_id: 'declaration-1', evidence_count: 1, reserve_id: 'reserve-1',
      open_reserves: [{
        id: 'reserve-1', motif: 'Enrobage insuffisant', expected_action: 'Reprendre l’enrobage',
        opened_at: '2026-09-27T20:10:00Z', opened_by: 'Bureau de contrôle Démonstration · Contrôleur',
        status: 'ouverte', status_label: 'Ouverte',
      }],
    })]);

    const card = await screen.findByTestId('reserve-card');
    expect(card).toHaveTextContent('Enrobage insuffisant');
    expect(card).toHaveTextContent('Reprendre l’enrobage');
    expect(card).toHaveTextContent('Bureau de contrôle Démonstration · Contrôleur, 27 sept. 2026, 20:10 (GMT, Abidjan)');
    const input = screen.getByLabelText('Correction pour Fondations');
    // La fiche précède le formulaire dans l'ordre du document.
    expect(card.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('PO-2026-09-28-17 : la barre « Corrections demandées » prend la couleur Attention, jamais le rouge', async () => {
    renderView([milestone({
      status: 'under_reserve', status_label: 'Corrections demandées', cdc_state: 'CHANGES_REQUESTED',
      work_declaration_id: 'declaration-1', evidence_count: 1, reserve_id: 'reserve-1',
    })]);
    // Adapté selon PO-2026-09-28-27 : la barre devient le segment de la jauge
    // (hachures Attention) ; la règle PO-2026-09-28-17 reste vérifiée.
    const segment = (await screen.findByRole('button', { name: /Jalon 1 sur 1, Fondations/ }))
      .querySelector('[data-testid="gauge-segment"]') as HTMLElement;
    expect(segment.dataset.state).toBe('CHANGES_REQUESTED');
    expect(segment.getAttribute('style')).toContain('--keya-alert-text');
    expect(segment.getAttribute('style')).not.toContain('danger');
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
    expect(screen.getByText('Un contrôleur est affecté à ce jalon.')).toBeInTheDocument();
    expect(screen.getByTestId('milestone-status-gros_oeuvre')).toHaveTextContent('Accepté techniquement');
  });
});

describe('MilestonesView — lecture de l\'avancement (ticket F-076)', () => {
  const foncier = milestone({ id: 'm1', order: 1, code: 'foncier', label: 'Foncier' });
  const fondations = milestone({
    id: 'm3', order: 3, status: 'accepted', status_label: 'Accepté techniquement', evidence_count: 2,
  });
  const grosOeuvre = milestone({ id: 'm4', order: 4, code: 'gros_oeuvre', label: 'Gros œuvre' });

  it('met en avant la réserve à corriger, puis la pièce manquante, puis le contrôle, puis le prochain à déclarer', () => {
    const reserve = milestone({ id: 'm5', order: 5, status: 'under_reserve', status_label: 'Sous réserve' });
    const docs = milestone({ id: 'm6', order: 6, status: 'awaiting_documents', status_label: 'Pièces attendues' });
    expect(focusMilestone([foncier, fondations, grosOeuvre, reserve, docs])?.id).toBe('m5');
    expect(focusMilestone([foncier, fondations, grosOeuvre, docs])?.id).toBe('m6');
    // Jamais « Foncier » (avant le dernier jalon déclaré) : le prochain à déclarer est « Gros œuvre ».
    expect(focusMilestone([foncier, fondations, grosOeuvre])?.id).toBe('m4');
  });

  // Adapté selon PO-2026-09-28-04 : l'échelle des niveaux vient du serveur,
  // avec la preuve de chaque niveau atteint (plus de dérivation côté écran).
  it('niveaux de confiance : échelle fournie par le serveur, niveaux non atteints visibles et vides', async () => {
    const evidence = { by: 'Constructeur Démo', role: 'Constructeur', at: '2026-09-27T20:10:00Z', version: 'déclaration n° 1', scope: 'Jalon « Gros œuvre », Lot A1' };
    renderView([foncier, fondations, milestone({ ...grosOeuvre, trust_levels: { declared: evidence } })]);
    const scale = await screen.findByRole('list', { name: 'Niveaux de confiance — Gros œuvre' });
    expect(scale.querySelectorAll('li')).toHaveLength(5);
    // Adapté selon PO-2026-09-28-18 : « organisation · rôle », jamais de parenthèses.
    expect(scale.querySelector('[data-testid="trust-level-declared"]')).toHaveTextContent('Constructeur Démo · Constructeur');
    expect(scale.querySelector('[data-testid="trust-level-declared"]')).toHaveTextContent('déclaration n° 1');
    expect(scale.querySelector('[data-testid="trust-level-documented"]')).toHaveTextContent('Non atteint');
  });

  it('le bandeau montre chaque jalon ; cliquer un jalon ouvre sa fiche', async () => {
    renderView([foncier, fondations, grosOeuvre]);

    expect(await screen.findByRole('region', { name: 'Jalon Gros œuvre' })).toBeInTheDocument();
    expect(screen.getByTestId('milestone-status-foncier')).toHaveTextContent('Non déclaré');
    fireEvent.click(screen.getByRole('button', { name: /Fondations/ }));
    expect(screen.getByRole('region', { name: 'Jalon Fondations' })).toHaveTextContent('Validé techniquement');
  });
});

describe('Lot 2 — rester sur le jalon et confirmer (PO-2026-09-28-60, P20)', () => {
  it('après « Proposer la correction », le jalon reste affiché et la suite est annoncée', async () => {
    const reserved = milestone({
      status: 'under_reserve', status_label: 'Sous réserve', work_declaration_id: 'declaration-1',
      evidence_count: 1, reserve_id: 'reserve-1',
    });
    const corrected = { ...reserved, correction_submitted: true };
    const next = milestone({ id: 'milestone-2', order: 4, code: 'elevation', label: 'Élévation' });
    const listLotMilestones = vi.fn()
      .mockResolvedValueOnce([reserved, next])
      .mockResolvedValue([corrected, next]);
    renderView([], {
      listLotMilestones,
      addEvidenceDocument: vi.fn().mockResolvedValue({ duplicateOf: null, evidenceId: 'evidence-2' }),
      createReserveCorrection: vi.fn().mockResolvedValue({}),
    });

    fireEvent.change(await screen.findByLabelText('Correction pour Fondations'), { target: { files: [PDF] } });
    fireEvent.click(screen.getByRole('button', { name: 'Proposer la correction' }));

    expect(await screen.findByTestId('milestone-done')).toHaveTextContent('Correction proposée — en attente de recontrôle');
    expect(screen.getByRole('heading', { name: '3. Fondations' })).toBeInTheDocument();
    // P21 : Élévation n'est pas « à déclarer » tant que Fondations n'est pas accepté.
    expect(screen.queryByText('Prochain jalon à déclarer')).not.toBeInTheDocument();
  });
});
