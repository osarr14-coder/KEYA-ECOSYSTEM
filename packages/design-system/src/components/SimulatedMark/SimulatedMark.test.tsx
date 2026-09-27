import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SIMULATION_MARKING } from '../../copy/demoCopy';
import { SimulatedMark } from './SimulatedMark';

describe('SimulatedMark — marquage unique des actes simulés (audit M03/M04)', () => {
  it('affiche le libellé du CDC §3.1, mot pour mot', () => {
    render(<SimulatedMark />);
    expect(screen.getByRole('note')).toHaveTextContent(SIMULATION_MARKING);
    expect(SIMULATION_MARKING).toBe('SIMULÉ — SANS VALEUR OPÉRATIONNELLE');
  });

  it('précise l’acte après le marquage, jamais à sa place', () => {
    render(<SimulatedMark detail="Virement" />);
    expect(screen.getByRole('note')).toHaveTextContent('SIMULÉ — SANS VALEUR OPÉRATIONNELLE · Virement');
  });

  it('style dédié : encre du thème et hachures, jamais le doré de la marque', () => {
    render(<SimulatedMark />);
    const style = screen.getByRole('note').getAttribute('style') ?? '';
    expect(style).toContain('var(--keya-neutral-heading)');
    expect(style).toContain('repeating-linear-gradient');
    expect(style).not.toMatch(/accent|#C49A2C|gold/i);
  });
});
