import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MOBILE_BREAKPOINT_PX } from '../../tokens/breakpoints';
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

describe('GlobalStyles — débordement horizontal des tableaux sur mobile (tickets F-051, F-075)', () => {
  it(
    'pose display: block + overflow-x: auto sur table SOUS le seuil mobile seulement — vérifié en navigateur '
    + 'réel que overflow-x seul ne suffit pas (F-051), et qu\'un tableau "block" ne s\'étire plus en grand écran (F-075)',
    () => {
      const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;

      const tableBlocks = css.match(/(?<![-\w])table\s*\{[^}]*\}/g) ?? [];
      expect(tableBlocks).toHaveLength(2);
      // Règle générale : largeur pleine, jamais "block".
      expect(tableBlocks[0]).toContain('border-collapse: collapse');
      expect(tableBlocks[0]).toContain('width: 100%');
      expect(tableBlocks[0]).not.toContain('display: block');
      // Règle mobile : défilement propre au tableau.
      const mobile = css.slice(css.indexOf(`@media (max-width: ${MOBILE_BREAKPOINT_PX}px)`));
      expect(mobile).toMatch(/table\s*\{[^}]*display: block;[^}]*overflow-x: auto/);
    },
  );
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

describe('GlobalStyles — responsive header AppShell (ticket F-050)', () => {
  it('pose une media query au seuil mobile partagé, faisant passer le header à la ligne', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;

    expect(css).toContain(`@media (max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    expect(css).toMatch(/\[data-testid="app-shell-header"\]\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it('le champ de recherche du header prend toute la largeur sous le seuil', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;

    expect(css).toMatch(/\[data-testid="app-shell-header"\] input\[type="search"\]\s*\{[^}]*width:\s*100%/);
  });
});

describe('GlobalStyles — mode sombre, source unique des deux palettes (ticket F-051)', () => {
  it(':root pose la palette claire « Confiance premium » (ticket F-073 : ivoire, encre, navy, or)', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;
    const rootBlock = css.match(/:root\s*\{[^}]*\}/)![0];

    expect(rootBlock).toContain('--keya-neutral-border: #E4DCCB');
    expect(rootBlock).toContain('--keya-neutral-background: #F7F3EA');
    expect(rootBlock).toContain('--keya-neutral-surface: #FFFFFF');
    expect(rootBlock).toContain('--keya-neutral-text: #16202E');
    expect(rootBlock).toContain('--keya-neutral-text-muted: #5B6472');
    expect(rootBlock).toContain('--keya-neutral-heading: #0B1D3A');
    expect(rootBlock).toContain('--keya-primary-background: #0B1D3A');
    expect(rootBlock).toContain('--keya-accent-solid: #C49A2C');
    expect(rootBlock).toContain('--keya-accent-text: #8A6A12');
    expect(rootBlock).toContain('--keya-alert-background: #FFFBEB');
    expect(rootBlock).toContain('--keya-danger-background: #FEF2F2');
    expect(rootBlock).toContain('--keya-progress-fill: #2F7D5B');
  });

  it('ticket F-073 : chaque token semanticColors référencé a bien sa variable dans les 3 blocs de thème', async () => {
    const { semanticColors } = await import('../../tokens/colors');
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;
    const blocks = [
      css.match(/:root\s*\{[^}]*\}/)![0],
      css.match(/:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}/)![0],
      css.match(/:root\[data-theme="dark"\]\s*\{[^}]*\}/)![0],
    ];
    const variables = Object.values(semanticColors)
      .flatMap((group) => Object.values(group) as string[])
      .map((value) => value.match(/var\((--keya-[\w-]+)\)/)![1]);
    for (const variable of variables) {
      for (const block of blocks) {
        expect(block).toContain(`${variable}:`);
      }
    }
  });

  it('@media (prefers-color-scheme: dark) redéfinit les mêmes variables, exclu si data-theme="light" explicite', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;

    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme="light"])');
    // Valeurs sombres réellement DIFFÉRENTES des valeurs claires — sinon
    // le mode sombre n'existerait que de nom.
    const darkBlock = css.match(/:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}/)![0];
    expect(darkBlock).toContain('--keya-neutral-background: #0A1628');
    expect(darkBlock).toContain('--keya-neutral-text: #F3F1EC');
    expect(darkBlock).not.toContain('#16202E');
  });

  it('[data-theme="dark"] pose les MÊMES valeurs sombres — override manuel gagne indépendamment de prefers-color-scheme', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;
    const explicitDeclarations = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)![1].replace(/\s/g, '');
    const mediaDeclarations = css.match(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)![1].replace(/\s/g, '');

    // Même contenu de VALEURS (déclarations entre accolades, sélecteurs
    // volontairement exclus de la comparaison) — une seule vraie palette
    // sombre, jamais deux jeux de valeurs à resynchroniser manuellement.
    expect(explicitDeclarations).toBe(mediaDeclarations);
    expect(explicitDeclarations.length).toBeGreaterThan(0);
  });

  it('l\'anneau de focus utilise un triplet R,G,B en variable, jamais un hex figé (doit s\'adapter au thème)', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;

    expect(css).toContain('rgba(var(--keya-focus-ring-rgb), 0.12)');
    expect(css).not.toContain('rgba(17, 24, 39, 0.12)');
  });

  /*
   * Ticket F-073 — révision de la doctrine F-051 : la direction « Confiance
   * premium » (validée par l'utilisateur) fait du navy et de l'or des rôles
   * SÉMANTIQUES thémés (action principale, accent), déclarés ici. Ce qui
   * reste interdit : la palette de marque en TEXTE courant (neutral.text)
   * ou en fond de page — le corps reste en encre sur ivoire.
   */
  it('ticket F-073 : navy/or vivent dans des rôles dédiés (primary/accent/heading), jamais en texte ou fond neutre', () => {
    const css = render(<GlobalStyles />).container.querySelector('style')!.textContent!;
    const rootBlock = css.match(/:root\s*\{[^}]*\}/)![0];

    expect(rootBlock).not.toMatch(/--keya-neutral-(text|background|surface):\s*#(0B1D3A|C49A2C)/);
    expect(rootBlock).toMatch(/--keya-accent-solid:\s*#C49A2C/);
  });
});
