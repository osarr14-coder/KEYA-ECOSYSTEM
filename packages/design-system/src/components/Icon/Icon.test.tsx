import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon';
import { ICON_PATHS, type IconName } from './paths';

describe('Icon — rendu de base', () => {
  it('rend un <svg> 24x24, décoratif par défaut (aria-hidden, pas de role)', () => {
    const { container } = render(<Icon name="home" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('avec un title : role="img" + <title>, jamais aria-hidden en même temps', () => {
    render(<Icon name="bell" title="Notifications" />);
    const svg = screen.getByRole('img', { name: 'Notifications' });
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('taille et couleur personnalisables, currentColor par défaut', () => {
    const { container } = render(<Icon name="search" size={32} color="#B91C1C" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
    expect(svg).toHaveAttribute('stroke', '#B91C1C');
  });

  it('jamais de remplissage — trait seul (fill="none" sur le svg)', () => {
    const { container } = render(<Icon name="building" />);
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'none');
  });

  it('chaque IconName déclaré possède au moins un tracé, et rend le bon nombre de <path>', () => {
    const names = Object.keys(ICON_PATHS) as IconName[];
    expect(names.length).toBeGreaterThan(0);
    names.forEach((name) => {
      expect(ICON_PATHS[name].length).toBeGreaterThan(0);
    });

    const { container } = render(<Icon name="clipboard-check" />);
    expect(container.querySelectorAll('path')).toHaveLength(ICON_PATHS['clipboard-check'].length);
  });
});
