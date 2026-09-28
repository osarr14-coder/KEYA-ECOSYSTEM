import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MissionDetail } from '../api/client';
import { documentLabel, MissionReviewView, opinionErrors } from './MissionReviewView';

const FIRST: MissionDetail = {
  id: 'm1', lotName: 'Lot A1', assetName: 'Bâtiment A', programName: 'Résidence Démonstration Abidjan',
  milestoneLabel: 'Fondations', followUp: false, completed: false,
  declaration: { id: 'wd1', declaredBy: 'constructeur.demo@keya.test', declaredAt: '2026-09-27T09:00:00Z', note: 'Semelles coulées' },
  evidences: [{
    id: 'ev1', version: 1, addedBy: 'constructeur.demo@keya.test', addedAt: '2026-09-27T09:05:00Z',
    documents: [{ id: 'doc1', fileName: 'fondations.jpg', sha256: 'abcdef0123456789' }],
  }],
  openReserves: [],
};

const FOLLOW_UP: MissionDetail = {
  ...FIRST,
  id: 'm2',
  followUp: true,
  evidences: [...FIRST.evidences, {
    id: 'ev2', version: 2, addedBy: 'constructeur.demo@keya.test', addedAt: '2026-09-28T10:00:00Z',
    documents: [{ id: 'doc2', fileName: 'correction.pdf', sha256: '99887766aabbccdd' }],
  }],
  openReserves: [{
    id: 'r1', motif: 'Enrobage insuffisant', expectedAction: 'Reprendre l’enrobage des armatures',
    openedAt: '2026-09-27T11:00:00Z', statusLabel: 'Correction proposée',
    corrections: [{ submittedAt: '2026-09-28T10:00:00Z', submittedBy: 'constructeur.demo@keya.test' }],
  }],
};

function renderView(detail: MissionDetail) {
  const api = {
    getMissionDetail: vi.fn().mockResolvedValue(detail),
    submitOpinion: vi.fn().mockResolvedValue({ inspectionId: 'i1', recordedAt: '2026-09-28T12:30:00Z' }),
    fetchDocument: vi.fn(),
  };
  render(<MissionReviewView missionId={detail.id} api={api} onBack={vi.fn()} />);
  return api;
}

describe('MissionReviewView — K01 pièces soumises', () => {
  it('montre en tête la déclaration et chaque pièce : fichier, version, déposant, date', async () => {
    renderView(FOLLOW_UP);
    const pieces = await screen.findAllByTestId('submitted-evidence');
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toHaveTextContent('Version 1 — déposée par constructeur.demo@keya.test, le 27 sept. 2026');
    expect(pieces[1]).toHaveTextContent('Pièce 1 (PDF)');
    expect(screen.getByText(/Déclaration de constructeur.demo@keya.test/)).toBeInTheDocument();
  });

  it('l’avis enregistre les versions examinées', async () => {
    const api = renderView(FIRST);
    fireEvent.click(await screen.findByLabelText('Conforme'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’avis' }));
    await waitFor(() => expect(api.submitOpinion).toHaveBeenCalled());
    expect(api.submitOpinion.mock.calls[0][1].examinedEvidenceIds).toEqual(['ev1']);
    expect(await screen.findByRole('status')).toHaveTextContent('horodatage serveur : 28 sept. 2026');
  });
});

describe('MissionReviewView — K02 réserves structurées', () => {
  it('non conforme : plusieurs réserves avec motif et action attendue, commentaire après la décision', async () => {
    const api = renderView(FIRST);
    fireEvent.click(await screen.findByLabelText('Non conforme — réserve(s)'));
    const [first] = screen.getAllByTestId('new-reserve');
    fireEvent.change(within(first).getByLabelText('Motif'), { target: { value: 'Fissure' } });
    fireEvent.change(within(first).getByLabelText('Action attendue du constructeur'), { target: { value: 'Reprendre la semelle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une réserve' }));
    const second = screen.getAllByTestId('new-reserve')[1];
    fireEvent.change(within(second).getByLabelText('Motif'), { target: { value: 'Photo floue' } });
    fireEvent.change(within(second).getByLabelText('Action attendue du constructeur'), { target: { value: 'Nouvelle photo' } });
    fireEvent.change(screen.getByLabelText('Commentaire (facultatif)'), { target: { value: 'RAS par ailleurs' } });
    // Le commentaire vient APRÈS la décision dans le formulaire.
    const form = screen.getByRole('form', { name: 'Avis du contrôleur' });
    const order = Array.from(form.querySelectorAll('legend, label')).map((el) => el.textContent ?? '');
    expect(order.findIndex((text) => text.startsWith('Commentaire'))).toBeGreaterThan(order.indexOf('Votre avis'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’avis' }));

    await waitFor(() => expect(api.submitOpinion).toHaveBeenCalled());
    const payload = api.submitOpinion.mock.calls[0][1];
    expect(payload.outcome).toBe('avec_reserve');
    expect(payload.reserves).toEqual([
      { motif: 'Fissure', expectedAction: 'Reprendre la semelle' },
      { motif: 'Photo floue', expectedAction: 'Nouvelle photo' },
    ]);
    expect(payload.note).toBe('RAS par ailleurs');
  });

  it('une réserve sans motif ou sans action attendue est refusée avant envoi', async () => {
    const api = renderView(FIRST);
    fireEvent.click(await screen.findByLabelText('Non conforme — réserve(s)'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’avis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Réserve 1 : motif et action attendue sont obligatoires.');
    expect(api.submitOpinion).not.toHaveBeenCalled();
  });
});

describe('MissionReviewView — K03 décision explicite par réserve', () => {
  it('un recontrôle exige Levée ou Maintenue avec motif pour chaque réserve ouverte', async () => {
    const api = renderView(FOLLOW_UP);
    fireEvent.click(await screen.findByLabelText('Conforme'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’avis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Décidez de la réserve « Enrobage insuffisant » : levée ou maintenue.');
    expect(api.submitOpinion).not.toHaveBeenCalled();

    const decision = screen.getByTestId('reserve-decision');
    fireEvent.click(within(decision).getByLabelText('Levée'));
    fireEvent.change(within(decision).getByLabelText('Motif de la décision'), { target: { value: 'Enrobage conforme sur photo v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’avis' }));

    await waitFor(() => expect(api.submitOpinion).toHaveBeenCalled());
    expect(api.submitOpinion.mock.calls[0][1].decisions).toEqual([
      { reserveId: 'r1', decision: 'levee', motif: 'Enrobage conforme sur photo v2' },
    ]);
    expect(api.submitOpinion.mock.calls[0][1].examinedEvidenceIds).toEqual(['ev1', 'ev2']);
  });

  it('jamais de levée implicite : un avis conforme avec une réserve maintenue est refusé', () => {
    expect(opinionErrors('conforme', [], FOLLOW_UP.openReserves, { r1: { decision: 'maintenue', motif: 'Toujours non conforme' } }))
      .toContain('Un avis conforme exige la levée de chaque réserve ouverte.');
    expect(opinionErrors('avec_reserve', [], FOLLOW_UP.openReserves, { r1: { decision: 'maintenue', motif: 'Toujours non conforme' } }))
      .toEqual([]);
  });
});

describe('documentLabel — libellé lisible des pièces soumises', () => {
  it('numérote la pièce et indique son format, jamais le nom technique', () => {
    expect(documentLabel('de364101-f502-4bb2-bcf2-a2587c3287ce.pdf', 0)).toBe('Pièce 1 (PDF)');
    expect(documentLabel('photo', 1)).toBe('Pièce 2');
  });
});

describe('MissionReviewView — niveaux de confiance du jalon (PO-2026-09-28-04)', () => {
  it('montre l’échelle, chaque niveau atteint avec qui, rôle, quand et version examinée', async () => {
    renderView({
      ...FIRST,
      trustLevels: {
        declared: { by: 'Constructeur Démo', role: 'Constructeur', at: '2026-09-27T09:00:00Z', version: 'déclaration n° 1', scope: 'Jalon « Fondations », Lot A1' },
        documented: { by: 'Constructeur Démo', role: 'Constructeur', at: '2026-09-27T09:05:00Z', version: 'pièce v1', scope: 'Jalon « Fondations », Lot A1' },
      },
    });
    const scale = await screen.findByRole('list', { name: 'Niveaux de confiance — Fondations' });
    expect(within(scale).getByTestId('trust-level-documented')).toHaveTextContent('pièce v1');
    expect(within(scale).getByTestId('trust-level-controlled')).toHaveTextContent('Non atteint');
    expect(scale.textContent).not.toMatch(/%|score/i);
  });
});
