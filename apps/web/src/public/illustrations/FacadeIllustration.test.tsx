import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FACADE_CAPTION, FacadeIllustration } from './FacadeIllustration';

function stubViewport(mobile: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: mobile, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

describe('FacadeIllustration — façade du programme fictif', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('est un SVG en ligne accessible, jamais une image externe', () => {
    render(<FacadeIllustration />);
    const figure = screen.getByTestId('facade-illustration');
    const drawing = within(figure).getByRole('img', { name: /Résidence Démonstration Abidjan \(programme fictif\)/ });
    expect(drawing.tagName.toLowerCase()).toBe('svg');
    expect(figure.querySelector('img')).toBeNull();
  });

  it('affiche toujours la mention « programme fictif » en texte réel', () => {
    render(<FacadeIllustration />);
    expect(FACADE_CAPTION).toMatch(/programme fictif, sans valeur contractuelle/);
    expect(screen.getByText(FACADE_CAPTION).tagName.toLowerCase()).toBe('figcaption');
  });

  it('couleurs : uniquement des variables du thème, aucune couleur en dur', () => {
    render(<FacadeIllustration />);
    const markup = screen.getByTestId('facade-illustration').outerHTML;
    expect(markup).toContain('var(--keya-');
    // `url(#…)` référence le motif de briques, pas une couleur.
    expect(markup).not.toMatch(/(?<!url\()#[0-9a-f]{3,6}\b/i);
    expect(markup).not.toMatch(/rgba?\(\d/);
  });

  it('sur mobile (< 640 px), les jalons passent dans une légende HTML lisible', () => {
    stubViewport(true);
    render(<FacadeIllustration />);
    const legend = screen.getByTestId('facade-legend');
    expect(within(legend).getByText('Jalon 1 · Fondations')).toBeInTheDocument();
    expect(within(legend).getByText('Jalon 2 · Élévation')).toBeInTheDocument();
    expect(screen.getByText(FACADE_CAPTION)).toBeInTheDocument();
  });

  it('sur ordinateur, les jalons sont écrits dans le dessin (pas de légende en double)', () => {
    stubViewport(false);
    render(<FacadeIllustration />);
    expect(screen.queryByTestId('facade-legend')).toBeNull();
    expect(screen.getByText('Jalon 1 · Fondations')).toBeInTheDocument();
  });
});
