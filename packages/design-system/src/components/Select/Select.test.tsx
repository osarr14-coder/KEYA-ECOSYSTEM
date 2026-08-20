import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { semanticColors } from '../../tokens/colors';
import { Select } from './Select';

describe('Select', () => {
  it('rend un <select> natif avec la bordure neutre au repos, options rendues', () => {
    render(
      <Select aria-label="Pays">
        <option value="sn">Sénégal</option>
        <option value="ci">Côte d&apos;Ivoire</option>
      </Select>,
    );
    const select = screen.getByLabelText('Pays');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveStyle({ borderColor: semanticColors.neutral.border });
    expect(screen.getByRole('option', { name: 'Sénégal' })).toBeInTheDocument();
  });

  it('porte la classe partagée qui pilote le focus visible (GlobalStyles)', () => {
    render(<Select aria-label="Pays" />);
    expect(screen.getByLabelText('Pays')).toHaveClass('keya-select');
  });

  it('transmet value/onChange comme un <select> natif', () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Pays" value="sn" onChange={onChange}>
        <option value="sn">Sénégal</option>
        <option value="ci">Côte d&apos;Ivoire</option>
      </Select>,
    );
    const select = screen.getByLabelText('Pays') as HTMLSelectElement;
    expect(select.value).toBe('sn');
    fireEvent.change(select, { target: { value: 'ci' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('un style explicite passé en prop reste prioritaire', () => {
    render(<Select aria-label="Pays" style={{ borderColor: '#123456' }} />);
    expect(screen.getByLabelText('Pays')).toHaveStyle({ borderColor: '#123456' });
  });
});
