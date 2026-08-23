import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BRAND_GRADIENT, brandColors } from '@keya/design-system';

import { ProgramHeroCard } from './ProgramHeroCard';

const PROPS = {
  programName: 'Residence Baobab',
  assetName: 'Batiment A',
  lotName: 'Lot 12',
  assetLocation: 'Almadies, Dakar',
  onRefresh: () => {},
};

describe('ProgramHeroCard — carte hero navy/or (ticket F-046)', () => {
  it('affiche les 4 champs reçus dans le conteneur data-testid="hero"', () => {
    render(<ProgramHeroCard {...PROPS} />);
    const hero = screen.getByTestId('hero');
    expect(hero).toHaveTextContent('Residence Baobab');
    expect(hero).toHaveTextContent('Batiment A');
    expect(hero).toHaveTextContent('Lot 12');
    expect(hero).toHaveTextContent('Almadies, Dakar');
  });

  it('le nom du programme apparaît une seule fois (pas de redite bande navy + corps)', () => {
    render(<ProgramHeroCard {...PROPS} />);
    expect(screen.getAllByText('Residence Baobab')).toHaveLength(1);
  });

  it('la bande d\'en-tête est en navy (dégradé, ticket F-053), texte blanc', () => {
    const { container } = render(<ProgramHeroCard {...PROPS} />);
    const band = container.querySelector('[data-testid="hero"] > div:first-child');
    expect(band).toHaveStyle({ background: BRAND_GRADIENT, color: '#FFFFFF' });
  });

  it('le repère "K+" est un badge en dégradé or, texte navy', () => {
    render(<ProgramHeroCard {...PROPS} />);
    const mark = screen.getByTestId('hero-mark');
    expect(mark).toHaveTextContent('K+');
    expect(mark).toHaveStyle({ color: brandColors.navy });
  });

  it('asset_name reste le seul <h1> de la carte', () => {
    render(<ProgramHeroCard {...PROPS} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Batiment A' })).toBeInTheDocument();
  });

  it('le bouton Actualiser appelle onRefresh', () => {
    const onRefresh = vi.fn();
    render(<ProgramHeroCard {...PROPS} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
