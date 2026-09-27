import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CONTROLLER_DESIGNATION } from '@keya/design-system';

import { createMockApiClient, withApiClient } from '../testUtils';
import { PublicHome } from './PublicHome';
import { PublicLayout } from './PublicLayout';

/**
 * Audit UI R1, J01–J04 : la page publique décrit le mécanisme démontré,
 * sans promesse juridique ou commerciale.
 */
const FORBIDDEN = /séquestre|protégé|sécuris|garanti|missionné|prix figé|figé à la réservation|en toute confiance/i;

function renderPublicHome() {
  const api = createMockApiClient({
    getPublicOffer: vi.fn(() => Promise.resolve([])),
    getPublicWorksites: vi.fn(() => Promise.resolve([])),
  });
  return render(withApiClient(api, (
    <PublicLayout path="/" navigate={vi.fn()}>
      <PublicHome navigate={vi.fn()} />
    </PublicLayout>
  )));
}

describe('Page publique — textes (audit J01–J04)', () => {
  it('aucun terme de séquestre, de protection, de garantie, ni « prix figé »', async () => {
    const { container } = renderPublicHome();
    await waitFor(() => expect(screen.getByText('Aucun programme publié pour le moment.')).toBeInTheDocument());
    const text = container.textContent ?? '';
    expect(text).not.toMatch(FORBIDDEN);
    const labels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label')).join(' ');
    expect(labels).not.toMatch(FORBIDDEN);
  });

  it('J01 : « compte du programme (simulé) »', async () => {
    const { container } = renderPublicHome();
    await waitFor(() => expect(container.textContent).toMatch(/compte du programme \(simulé\)/));
  });

  it('J02 : le menu propose « Comment ça marche », plus « Garanties »', () => {
    renderPublicHome();
    const nav = screen.queryByRole('navigation', { name: 'Sections de la page' });
    // La navigation d'ancres n'existe qu'au-delà du point de rupture mobile.
    if (nav) {
      expect(nav).toHaveTextContent('Comment ça marche');
      expect(nav).not.toHaveTextContent(/Garanties/);
    }
    expect(screen.getByRole('heading', { name: 'Trois rôles distincts', level: 2 })).toBeInTheDocument();
  });

  it('J03 : formule neutre du PO pour le contrôleur, jamais « missionné par KEYIMMO »', () => {
    renderPublicHome();
    expect(screen.getAllByText((_, el) => el?.textContent?.trim() === CONTROLLER_DESIGNATION).length).toBeGreaterThan(0);
  });
});
