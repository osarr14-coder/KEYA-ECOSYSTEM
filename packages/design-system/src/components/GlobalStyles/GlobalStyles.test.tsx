import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { typography } from '../../tokens/typography';
import { GlobalStyles } from './GlobalStyles';

describe('GlobalStyles — reset minimal partagé (ticket 023)', () => {
  it('rend une balise <style> unique, sans wrapper visible', () => {
    render(<GlobalStyles />);
    expect(screen.getByTestId('global-styles').tagName).toBe('STYLE');
  });

  it('déclare la police partagée (aucune app ne le fait ailleurs)', () => {
    render(<GlobalStyles />);
    expect(screen.getByTestId('global-styles').textContent).toContain(typography.fontFamily);
  });
});

describe('GlobalStyles — consolidation des styles de tableau (ticket F-041)', () => {
  it('pose un traitement de tableau générique (bordures, alignement, survol, chiffres alignés)', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;

    expect(css).toContain('border-collapse: collapse');
    // `th` doit forcer l'alignement à gauche — c'est le comportement par
    // défaut du navigateur (centré) qui apparaîtrait sinon une fois le
    // style inline équivalent retiré des 5 vues consommatrices.
    expect(css).toMatch(/th\s*\{[^}]*text-align:\s*left/);
    expect(css).toContain('font-variant-numeric: tabular-nums');
    expect(css).toMatch(/tbody tr:hover td\s*\{/);
  });
});
