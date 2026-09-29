import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CountIndicator, Indicator, indicatorValue } from './Indicator';

describe('Indicator — indicateur traçable (PO-2026-09-27-20, CDC §9.3)', () => {
  it('dénominateur nul → « Non applicable », jamais « 100 % »', () => {
    expect(indicatorValue(0, 0)).toBe('Non applicable');
    render(<Indicator label="Jalons acceptés" numerator={0} denominator={0} unit="jalons déclarés" data-testid="ind" />);
    expect(screen.getByTestId('ind-value')).toHaveTextContent('Non applicable');
    expect(screen.getByTestId('ind')).toHaveTextContent('0 / 0 jalons déclarés');
    expect(screen.getByTestId('ind')).not.toHaveTextContent('100');
  });

  it('numérateur et dénominateur visibles, clic vers les sources', () => {
    const onOpenSources = vi.fn();
    render(<Indicator label="Jalons acceptés" numerator={3} denominator={4} unit="jalons déclarés" onOpenSources={onOpenSources} />);
    const button = screen.getByRole('button', { name: /Jalons acceptés/ });
    expect(button).toHaveTextContent('75 %');
    expect(button).toHaveTextContent('3 / 4 jalons déclarés');
    fireEvent.click(button);
    expect(onOpenSources).toHaveBeenCalledTimes(1);
  });

  it('précise ce que le ratio ne dit pas (présence, pas conformité)', () => {
    render(<Indicator label="Pièces exigées déposées" numerator={1} denominator={4} unit="pièces exigées" note="Présence d’une pièce, pas sa conformité." data-testid="p" />);
    expect(screen.getByTestId('p')).toHaveTextContent('25 %');
    expect(screen.getByTestId('p')).toHaveTextContent('Présence d’une pièce, pas sa conformité.');
  });
});

describe('CountIndicator — variante « comptes » (lot 4, PO-2026-09-28-66)', () => {
  it('affiche des comptes, jamais un pourcentage, et ouvre les sources', () => {
    const onOpenSources = vi.fn();
    render(
      <CountIndicator
        label="Réserves"
        counts={[{ label: 'ouvertes', value: 1 }, { label: 'levées', value: 2 }]}
        detail="La plus ancienne ouverte : 3 j"
        onOpenSources={onOpenSources}
        data-testid="r"
      />,
    );
    const button = screen.getByRole('button', { name: /Réserves/ });
    expect(screen.getByTestId('r-ouvertes')).toHaveTextContent(/^1\s*ouvertes$/);
    expect(screen.getByTestId('r-levées')).toHaveTextContent(/^2\s*levées$/);
    expect(button).toHaveTextContent('La plus ancienne ouverte : 3 j');
    expect(button).not.toHaveTextContent('%');
    fireEvent.click(button);
    expect(onOpenSources).toHaveBeenCalledTimes(1);
  });
});
