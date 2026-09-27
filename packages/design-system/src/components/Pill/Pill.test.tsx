import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { semanticColors } from '../../tokens/colors';
import { Pill } from './Pill';

describe('Pill — pastille d\'état métier (ticket F-073)', () => {
  it('rend le texte, ton neutre par défaut', () => {
    render(<Pill data-testid="pill">Brouillon</Pill>);
    const pill = screen.getByTestId('pill');
    expect(pill).toHaveTextContent('Brouillon');
    expect(pill).toHaveAttribute('data-tone', 'neutral');
    expect(pill).toHaveStyle({ background: semanticColors.neutral.subtle });
  });

  it.each([
    ['success', semanticColors.success.background, semanticColors.success.text],
    // PO-2026-09-27-20 (DESIGN_SYSTEM §8.2) : le doré n'est jamais un état ;
    // « accent » s'affiche comme Attention, « primary » comme Information.
    ['accent', semanticColors.alert.background, semanticColors.alert.text],
    ['danger', semanticColors.danger.background, semanticColors.danger.text],
    ['alert', semanticColors.alert.background, semanticColors.alert.text],
    ['primary', semanticColors.info.background, semanticColors.info.text],
    ['info', semanticColors.info.background, semanticColors.info.text],
  ] as const)('ton %s : fond et texte du rôle sémantique correspondant', (tone, background, color) => {
    render(<Pill tone={tone} data-testid="pill">État</Pill>);
    expect(screen.getByTestId('pill')).toHaveStyle({ background, color });
  });
});

describe('Pill — badge compact (PO-2026-09-27-20, constats V06 et V09)', () => {
  it('point de couleur + libellé, rayon 4 px, jamais une couleur de marque', () => {
    render(<Pill tone="accent" data-testid="pill">Bien bloqué</Pill>);
    const pill = screen.getByTestId('pill');
    expect(pill).toHaveTextContent('Bien bloqué');
    expect(pill).toHaveStyle({ borderRadius: '4px' });
    expect(pill.getAttribute('style')).not.toMatch(/accent/);
    expect(pill.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });
});
