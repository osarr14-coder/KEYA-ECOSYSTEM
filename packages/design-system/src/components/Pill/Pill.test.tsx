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
    ['accent', semanticColors.accent.soft, semanticColors.accent.text],
    ['danger', semanticColors.danger.background, semanticColors.danger.text],
    ['alert', semanticColors.alert.background, semanticColors.alert.text],
    ['primary', semanticColors.primary.background, semanticColors.primary.text],
  ] as const)('ton %s : fond et texte du rôle sémantique correspondant', (tone, background, color) => {
    render(<Pill tone={tone} data-testid="pill">État</Pill>);
    expect(screen.getByTestId('pill')).toHaveStyle({ background, color });
  });
});
