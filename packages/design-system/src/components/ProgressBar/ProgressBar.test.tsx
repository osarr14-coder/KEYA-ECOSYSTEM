import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './ProgressBar';

describe('ProgressBar — affichage passthrough (ticket 023)', () => {
  it('affiche EXACTEMENT le pourcentage reçu, sans le recalculer', () => {
    render(<ProgressBar percentage={37} />);
    const fill = screen.getByTestId('progress-bar-fill');
    expect(fill).toHaveStyle({ width: '37%' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '37');
  });

  it('accepte une largeur personnalisée pour la piste', () => {
    render(<ProgressBar percentage={50} width="80px" />);
    expect(screen.getByTestId('progress-bar')).toHaveStyle({ width: '80px' });
  });

  it('largeur par défaut à 100% (usage pleine largeur)', () => {
    render(<ProgressBar percentage={10} />);
    expect(screen.getByTestId('progress-bar')).toHaveStyle({ width: '100%' });
  });
});

describe(
  'ProgressBar — accessibilité (ticket 024, audit) : la barre reste '
  + 'décorative/complémentaire, le pourcentage exact est toujours affiché en '
  + 'texte à côté par les vues appelantes',
  () => {
    it('expose une bordure définissant sa frontière (contraste non textuel WCAG 1.4.11)', () => {
      render(<ProgressBar percentage={37} />);
      const bar = screen.getByTestId('progress-bar');
      expect(bar.style.border).not.toBe('');
    });

    it('aria-valuetext annonce le pourcentage de façon lisible', () => {
      render(<ProgressBar percentage={37} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '37 %');
    });
  },
);
