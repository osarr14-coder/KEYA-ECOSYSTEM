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

describe('GlobalStyles — échelle typographique (ticket F-042)', () => {
  it('pose h1 à h4 en unités em, jamais une valeur px figée', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;

    expect(css).toMatch(/h1\s*\{[^}]*font-size:\s*1\.75em/);
    expect(css).toMatch(/h2\s*\{[^}]*font-size:\s*1\.35em/);
    expect(css).toMatch(/h3\s*\{[^}]*font-size:\s*1\.1em/);
    expect(css).toMatch(/h4\s*\{[^}]*font-size:\s*1em/);
    // Aucune règle h5/h6 : jamais utilisés dans les 4 apps (inventaire
    // réel avant conception), pas de valeur inventée pour un niveau non
    // testable.
    expect(css).not.toMatch(/\bh5\s*\{/);
    expect(css).not.toMatch(/\bh6\s*\{/);
  });

  it(
    'étend LE MÊME bloc th posé par F-041 (une seule règle par propriété), '
    + 'jamais un second sélecteur th séparé',
    () => {
      const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;

      const thBlocks = css.match(/(?<![-\w])th\s*\{[^}]*\}/g) ?? [];
      expect(thBlocks).toHaveLength(1);
      expect(thBlocks[0]).toContain('font-size: 0.85em');
      expect(thBlocks[0]).toContain('font-weight: 500');
      expect(thBlocks[0]).toContain('text-align: left');
      expect(thBlocks[0]).toContain('border-bottom: 2px solid');
    },
  );
});
