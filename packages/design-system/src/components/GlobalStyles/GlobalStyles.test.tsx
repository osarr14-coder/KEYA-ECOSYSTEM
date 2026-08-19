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
