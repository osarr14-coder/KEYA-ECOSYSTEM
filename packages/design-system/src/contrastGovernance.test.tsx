import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GlobalStyles } from './components/GlobalStyles/GlobalStyles';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §3.2, X04) : contrastes WCAG AA (4,5:1)
 * calculés sur les VALEURS RÉELLES des jetons (clair et sombre), pour
 * chaque paire texte / fond utilisée par les composants.
 */

function palette(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--keya-([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(([, name, hex]) => [name, hex]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground: string, background: string) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const css = () => render(<GlobalStyles />).container.querySelector('style')!.textContent!;

const PAIRS: [string, string][] = [
  ['neutral-text', 'neutral-background'],
  ['neutral-text', 'neutral-surface'],
  ['neutral-text-muted', 'neutral-background'],
  ['neutral-text-muted', 'neutral-surface'],
  ['neutral-text-muted', 'neutral-subtle'],
  ['neutral-heading', 'neutral-background'],
  ['alert-text', 'alert-background'],
  ['danger-text', 'danger-background'],
  ['success-text', 'success-background'],
  ['info-text', 'info-background'],
];

describe('Contrastes AA des jetons (PO-2026-09-27-20, X04)', () => {
  it('thème clair : chaque paire texte / fond atteint 4,5:1', () => {
    const light = palette(css().split('@media')[0]);
    const failures = [...PAIRS, ['primary-text', 'primary-background'], ['accent-on-solid', 'accent-solid'], ['accent-text', 'neutral-surface']]
      .map(([fg, bg]) => [fg, bg, ratio(light[fg], light[bg])] as const)
      .filter(([, , value]) => value < 4.5);
    expect(failures).toEqual([]);
  });

  it('thème sombre : chaque paire texte / fond atteint 4,5:1', () => {
    const darkBlock = css().split('@media (prefers-color-scheme: dark)')[1].split('}')[0];
    expect(Object.keys(palette(darkBlock)).length).toBeGreaterThan(15);
    const dark = { ...palette(css().split('@media')[0]), ...palette(darkBlock) };
    const failures = PAIRS
      .map(([fg, bg]) => [fg, bg, ratio(dark[fg], dark[bg])] as const)
      .filter(([, , value]) => value < 4.5);
    expect(failures).toEqual([]);
  });
});
