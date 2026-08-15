import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { semanticColors } from '../../tokens/colors';
import { AlertBanner } from './AlertBanner';

describe('AlertBanner — ressort clairement sans lecture attentive du texte', () => {
  it('expose role="alert" pour les technologies d\'assistance', () => {
    render(<AlertBanner title="Réserve ouverte" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('affiche une icône visuelle distincte du texte', () => {
    const { container } = render(<AlertBanner title="Réserve ouverte" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applique les tokens de couleur sémantique "alerte" (pas une couleur ad hoc)', () => {
    render(<AlertBanner title="Réserve ouverte" />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveStyle({ background: semanticColors.alert.background });
    expect(banner).toHaveStyle({ borderColor: semanticColors.alert.border });
  });

  it('affiche le titre et, si fourni, le contenu additionnel', () => {
    render(<AlertBanner title="Réserve ouverte">Fissure en façade</AlertBanner>);
    expect(screen.getByText('Réserve ouverte')).toBeInTheDocument();
    expect(screen.getByText('Fissure en façade')).toBeInTheDocument();
  });

  it("n'affiche pas de bloc de contenu additionnel quand aucun children n'est fourni", () => {
    const { container } = render(<AlertBanner title="Réserve ouverte" />);
    // Un seul enfant textuel (le titre) dans le conteneur de texte — pas de
    // <div> vide généré pour rien.
    const textContainer = screen.getByText('Réserve ouverte').parentElement;
    expect(textContainer?.children).toHaveLength(1);
  });
});
