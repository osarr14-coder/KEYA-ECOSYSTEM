import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Indicator, indicatorValue } from './Indicator';

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
});
