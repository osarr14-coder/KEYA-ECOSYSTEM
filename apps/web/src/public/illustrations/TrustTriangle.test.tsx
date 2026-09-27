import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CONTROLLER_DESIGNATION, TRUST_TRIANGLE_NOTE, TrustTriangle } from './TrustTriangle';

describe('TrustTriangle — Triangle de Confiance accessible', () => {
  it('se lit comme une liste de trois rôles, chacun avec un titre', () => {
    render(<TrustTriangle />);
    const list = screen.getByRole('list', { name: 'Trois rôles distincts' });
    const poles = within(list).getAllByRole('article');
    expect(poles).toHaveLength(3);
    expect(within(list).getByRole('heading', { name: 'KEYIMMO AFRIC' })).toBeInTheDocument();
    expect(within(list).getByRole('heading', { name: 'Compte du programme (simulé)' })).toBeInTheDocument();
    expect(within(list).getByRole('heading', { name: 'Contrôleur' })).toBeInTheDocument();
  });

  it('les liens du triangle sont décoratifs', () => {
    render(<TrustTriangle />);
    const links = screen.getByTestId('trust-triangle').querySelector('svg.keya-trust__links');
    expect(links).toHaveAttribute('aria-hidden', 'true');
  });

  it('J03 : formule neutre du PO pour le contrôleur, sans « missionné par »', () => {
    render(<TrustTriangle />);
    expect(screen.getByText(CONTROLLER_DESIGNATION)).toBeInTheDocument();
    expect(screen.getByTestId('trust-triangle').textContent).not.toMatch(/missionné/i);
  });

  it('J01/J02 : aucun terme de protection ou de séquestre, mention « programme fictif » visible', () => {
    render(<TrustTriangle />);
    const text = screen.getByTestId('trust-triangle').textContent ?? '';
    expect(text).not.toMatch(/séquestre|sécuris|garanti|coffre|indépendance totale/i);
    expect(screen.getByTestId('trust-triangle-note')).toHaveTextContent(TRUST_TRIANGLE_NOTE);
    expect(TRUST_TRIANGLE_NOTE).toMatch(/programme fictif/);
  });

  it('disposition verticale sous 640 px (règle CSS embarquée)', () => {
    render(<TrustTriangle />);
    const css = screen.getByTestId('trust-triangle').querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  });
});
