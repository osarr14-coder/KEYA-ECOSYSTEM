import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FacadeGauge } from '../FacadeGauge/FacadeGauge';
import { MilestoneGauge } from './MilestoneGauge';
import { MILESTONE_STATES, milestoneStateLabel } from './milestoneStates';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = [
  path.join(here, 'MilestoneGauge.tsx'),
  path.join(here, 'milestoneStates.ts'),
  path.join(here, '../FacadeGauge/FacadeGauge.tsx'),
  path.join(here, '../FacadeGauge/facadeDrawing.ts'),
];

const TWO = [
  { id: 'm1', label: 'Fondations', cdcState: 'CHANGES_REQUESTED', statusLabel: 'Corrections demandées', openReserveCount: 1 },
  { id: 'm2', label: 'Élévation', cdcState: 'DRAFT', statusLabel: 'Brouillon' },
];

afterEach(() => { vi.restoreAllMocks(); });

describe('Garde — jauges sans pourcentage ni ratio (PO-2026-09-28-29)', () => {
  it('aucun caractère « % » ni calcul de ratio dans les deux composants', () => {
    for (const file of SOURCES) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/%/);
      expect(code, file).not.toMatch(/\/\s*(total|milestones\.length|count)\b|\*\s*100|toFixed|percent/i);
    }
  });

  it('chaque état CDC a son rendu, distinct, dans la jauge et dans la façade', () => {
    render(<MilestoneGauge milestones={MILESTONE_STATES.map((state) => ({ id: state, label: state, cdcState: state }))} />);
    const segments = screen.getAllByTestId('gauge-segment');
    expect(segments.map((segment) => segment.dataset.state)).toEqual(MILESTONE_STATES);
    const styles = new Set(segments.map((segment) => segment.getAttribute('style')));
    // Soumis et Resoumis partagent le même rendu (référence) : 6 rendus pour 7 états.
    expect(styles.size).toBe(6);

    for (const state of MILESTONE_STATES) {
      const { container, unmount } = render(<FacadeGauge states={{ fondations: state, elevation: 'DRAFT' }} />);
      expect(container.querySelector('[data-jalon="fondations"]')!.getAttribute('class')).toMatch(/st-(draft|sub|review|changes|ok|stale)/);
      unmount();
    }
  });

  it('un état inconnu est une erreur visible en développement, jamais « accepté » par défaut', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MilestoneGauge milestones={[{ id: 'x', label: 'Fondations', cdcState: 'ACCEPTED_MAYBE' }]} />);
    const segment = screen.getByTestId('gauge-segment');
    expect(segment.dataset.state).toBe('UNKNOWN');
    expect(screen.getByText('État inconnu : ACCEPTED_MAYBE')).toBeInTheDocument();
    expect(error).toHaveBeenCalled();

    const { container } = render(<FacadeGauge states={{ fondations: 'ACCEPTED_MAYBE', elevation: 'DRAFT' }} />);
    expect(container.querySelector('[data-jalon="fondations"]')!.getAttribute('class')).toContain('st-unknown');
    expect(container.querySelector('[data-jalon="fondations"]')!.getAttribute('class')).not.toContain('st-ok');
  });
});

describe('MilestoneGauge — carte (PO-2026-09-28-27)', () => {
  it('une liste ordonnée, un bouton par jalon, lu « Jalon 1 sur 2, Fondations, Corrections demandées, 1 réserve ouverte »', () => {
    const onSelect = vi.fn();
    render(<MilestoneGauge milestones={TWO} selectedId="m1" onSelect={onSelect} />);
    const list = screen.getByRole('list', { name: 'Jalons du chantier' });
    expect(list.tagName).toBe('OL');
    const first = within(list).getByRole('button', { name: 'Jalon 1 sur 2, Fondations, Corrections demandées, 1 réserve ouverte' });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveStyle({ minHeight: '44px' });
    expect(first.querySelector('[data-testid="gauge-segment"]')!.getAttribute('style')).toContain('outline: 2px solid');
    const second = within(list).getByRole('button', { name: 'Jalon 2 sur 2, Élévation, Brouillon' });
    fireEvent.click(second);
    expect(onSelect).toHaveBeenCalledWith('m2');
    // Segments de largeur égale : une colonne de même taille par jalon.
    expect(list.getAttribute('style')).toContain('repeat(2, minmax(0, 1fr))');
  });

  it('version compacte : segments de 8 px, lecture seule, même lecture accessible', () => {
    render(<MilestoneGauge variant="compact" milestones={TWO} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Jalon 1 sur 2, Fondations, Corrections demandées, 1 réserve ouverte')).toBeInTheDocument();
    expect(screen.getAllByTestId('gauge-segment')[0].getAttribute('style')).toContain('height: 8px');
  });
});

describe('FacadeGauge (PO-2026-09-28-28)', () => {
  it('libellé SVG décrivant chaque partie ; trait plein seulement si accepté', () => {
    const { container } = render(<FacadeGauge states={{ fondations: 'TECHNICALLY_ACCEPTED', elevation: 'UNDER_REVIEW' }} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label', 'Façade de la résidence : fondations accepté techniquement, élévation en examen',
    );
    expect(container.querySelector('[data-jalon="fondations"]')!.getAttribute('class')).toContain('st-ok');
    expect(container.querySelector('[data-jalon="elevation"]')!.getAttribute('class')).toContain('st-review');
    // Dessin sur surface claire, même en mode sombre.
    expect(screen.getByTestId('facade-gauge')).toHaveClass('keya-light-surface');
  });

  it('sans repères dans la frise ; couleurs par variables du thème uniquement', () => {
    const { container } = render(<FacadeGauge markers={false} states={{ fondations: 'DRAFT', elevation: 'DRAFT' }} />);
    expect(container.querySelector('[data-marker]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}\b/i);
  });
});

describe('États et libellés (PO-2026-09-28-31)', () => {
  it('seul le code serveur CHANGES_REQUESTED est accepté ; CHANGES_REQUIRED (CDC) est un état inconnu visible', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MilestoneGauge milestones={[{ id: 'x', label: 'Fondations', cdcState: 'CHANGES_REQUIRED' }]} />);
    expect(screen.getByTestId('gauge-segment')).toHaveAttribute('data-state', 'UNKNOWN');
    expect(screen.getByText('État inconnu : CHANGES_REQUIRED')).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });

  it('« Nouvelle revue nécessaire » ; brouillon « Pas encore déclaré » pour le client', () => {
    expect(milestoneStateLabel('REVIEW_REQUIRED')).toBe('Nouvelle revue nécessaire');
    expect(milestoneStateLabel('DRAFT')).toBe('Brouillon');
    expect(milestoneStateLabel('DRAFT', 'client')).toBe('Pas encore déclaré');
    render(<FacadeGauge audience="client" states={{ fondations: 'UNDER_REVIEW', elevation: 'DRAFT' }} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Façade de la résidence : fondations en examen, élévation pas encore déclaré');
  });
});
