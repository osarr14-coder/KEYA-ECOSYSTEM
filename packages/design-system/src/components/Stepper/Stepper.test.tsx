import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Stepper } from './Stepper';

const STEPS = [
  { id: 'a', label: 'Réservation', state: 'done' as const },
  { id: 'b', label: 'Validation', state: 'current' as const, caption: 'Sous 48 h' },
  { id: 'c', label: 'Contrat', state: 'upcoming' as const },
];

describe('Stepper — suite d\'étapes (ticket F-074)', () => {
  it('rend une liste ordonnée nommée, une entrée par étape', () => {
    render(<Stepper steps={STEPS} aria-label="Étapes" />);
    const list = screen.getByRole('list', { name: 'Étapes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it("l'état est dit en texte (jamais par la couleur seule) et l'étape courante porte aria-current", () => {
    render(<Stepper steps={STEPS} aria-label="Étapes" />);
    expect(screen.getByTestId('step-a')).toHaveTextContent('Étape 1 · fait');
    expect(screen.getByTestId('step-b')).toHaveTextContent('Étape 2 · en cours');
    expect(screen.getByTestId('step-b')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('step-c')).toHaveTextContent('Étape 3 · à venir');
    expect(screen.getByTestId('step-c')).not.toHaveAttribute('aria-current');
  });

  it('affiche la précision optionnelle', () => {
    render(<Stepper steps={STEPS} aria-label="Étapes" />);
    expect(screen.getByTestId('step-b')).toHaveTextContent('Sous 48 h');
  });
});
