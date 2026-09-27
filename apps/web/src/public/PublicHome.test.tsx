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

describe('Page publique — registre de démonstration (audit J05, PO-2026-09-27-13)', () => {
  it('J05 : aucun registre commercial (« nos programmes », « avancement réel », « achetez »)', async () => {
    const { container } = renderPublicHome();
    await waitFor(() => expect(screen.getByText('Aucun programme publié pour le moment.')).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/nos programmes|nos chantiers|avancement réel|achetez|déjà acquéreur/i);
    expect(container.textContent).toMatch(/programme fictif/);
  });

  it('PO-13 : jamais « promoteur » ; le programme est lancé par KEYIMMO AFRIC, le constructeur est nommé', async () => {
    const api = createMockApiClient({
      getPublicOffer: vi.fn(() => Promise.resolve([{
        id: 'p1', name: 'Résidence Démonstration Abidjan', constructeur: 'Constructeur Démonstration Abidjan', locations: ['Cocody'],
        currency: 'XOF', total_lots: 1, available_lots: 1, price_from: '30000000.00',
        lots: [{ id: 'lot-1', name: 'Lot A1', asset: 'Bâtiment A', surface: '82.00', price: '30000000.00' }],
        payment_schedule: {
          reservation_fee: '100000',
          steps: [{ code: 'reservation', label: 'Premier versement (réservation)', cumulative_cap_percent: '10.00' }],
        },
      }])),
      getPublicWorksites: vi.fn(() => Promise.resolve([])),
    });
    const { container } = render(withApiClient(api, (
      <PublicLayout path="/" navigate={vi.fn()}>
        <PublicHome navigate={vi.fn()} />
      </PublicLayout>
    )));
    await waitFor(() => expect(container.textContent).toMatch(/Constructeur : Constructeur Démonstration Abidjan/));
    expect(container.textContent).toMatch(/Programme lancé par KEYIMMO AFRIC/);
    expect(container.textContent).not.toMatch(/promoteur/i);
  });
});
