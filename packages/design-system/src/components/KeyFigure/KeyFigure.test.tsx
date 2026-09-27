import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KeyFigure } from './KeyFigure';

describe('KeyFigure — chiffre clé (ticket F-075)', () => {
  it('affiche libellé, valeur et précision, sans bouton par défaut', () => {
    render(<KeyFigure label="Prix figé" value="30 000 000 XOF" hint="TTC" data-testid="kf" />);
    expect(screen.getByTestId('kf')).toHaveTextContent('Prix figé');
    expect(screen.getByTestId('kf-value')).toHaveTextContent('30 000 000 XOF');
    expect(screen.getByTestId('kf')).toHaveTextContent('TTC');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('avec onClick, la tuile entière est un bouton', () => {
    const onClick = vi.fn();
    render(<KeyFigure label="Réservations à valider" value={2} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Réservations à valider/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
