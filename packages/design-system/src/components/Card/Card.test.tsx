import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { semanticColors } from '../../tokens/colors';
import { Card } from './Card';

describe('Card — conteneur de section générique', () => {
  it('rend le titre en <h2> et le contenu', () => {
    render(<Card title="Dernier événement">Contenu de la section</Card>);
    expect(screen.getByRole('heading', { level: 2, name: 'Dernier événement' })).toBeInTheDocument();
    expect(screen.getByText('Contenu de la section')).toBeInTheDocument();
  });

  it('sans titre, ne rend aucun <h2>', () => {
    render(<Card>Contenu seul</Card>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('a une bordure et un fond distincts du texte brut (regroupement visuel réel)', () => {
    const { container } = render(<Card title="Titre">Contenu</Card>);
    const section = container.querySelector('section');
    expect(section).toHaveStyle({
      border: `1px solid ${semanticColors.neutral.border}`,
      background: semanticColors.neutral.surface,
    });
  });

  it('tone="accent" colore l\'icône en vert de progression, jamais le fond entier (pas AlertBanner)', () => {
    const { container } = render(<Card title="Titre" icon="check-circle" tone="accent">Contenu</Card>);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('stroke', semanticColors.progress.fill);
    expect(container.querySelector('section')).toHaveStyle({ background: semanticColors.neutral.surface });
  });
});
