import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/client';
import { createMockApiClient, withApiClient } from '../testUtils';
import { FACADE_TIMELINE_STEPS } from './illustrations/FacadeTimeline';
import { PublicHome } from './PublicHome';
import { PublicLayout } from './PublicLayout';

/**
 * PO-2026-09-28-28 (D3) et PO-2026-09-28-29 (E) : la section « Comment ça
 * marche » porte la frise figée en 4 étapes de la référence, avec la mention
 * « illustration — programme fictif » ; la page publique n'appelle aucune
 * donnée de dossier (seuls les deux points d'accès anonymes de la vitrine).
 */
const PUBLIC_CALLS = new Set<keyof ApiClient>(['getPublicOffer', 'getPublicWorksites']);

function renderPublicHome() {
  const api = createMockApiClient({
    getPublicOffer: vi.fn(() => Promise.resolve([])),
    getPublicWorksites: vi.fn(() => Promise.resolve([])),
  });
  render(withApiClient(api, (
    <PublicLayout path="/" navigate={vi.fn()}>
      <PublicHome navigate={vi.fn()} />
    </PublicLayout>
  )));
  return api;
}

describe('Page publique — frise de la façade (D3)', () => {
  it('quatre étapes figées, dans l’ordre de la référence, avec la mention « illustration — programme fictif »', async () => {
    renderPublicHome();
    const section = screen.getByRole('region', { name: 'Trois rôles distincts' });
    const timeline = within(section).getByTestId('facade-timeline');
    expect(timeline).toHaveTextContent(/illustration — programme fictif/i);
    const steps = within(timeline).getAllByTestId('facade-timeline-step');
    expect(steps.map((step) => within(step).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Fondations en examen', 'Réserve ouverte', 'Fondations acceptées', 'Élévation en examen',
    ]);
    expect(steps.map((step) => within(step).getByRole('img').getAttribute('aria-label'))).toEqual([
      'Façade de la résidence : fondations en examen, élévation brouillon',
      'Façade de la résidence : fondations corrections demandées, élévation brouillon',
      'Façade de la résidence : fondations accepté techniquement, élévation brouillon',
      'Façade de la résidence : fondations accepté techniquement, élévation en examen',
    ]);
    // États figés : aucune donnée de l'API n'alimente la frise.
    expect(FACADE_TIMELINE_STEPS.map((step) => step.states)).toEqual([
      { fondations: 'UNDER_REVIEW', elevation: 'DRAFT' },
      { fondations: 'CHANGES_REQUESTED', elevation: 'DRAFT' },
      { fondations: 'TECHNICALLY_ACCEPTED', elevation: 'DRAFT' },
      { fondations: 'TECHNICALLY_ACCEPTED', elevation: 'UNDER_REVIEW' },
    ]);
    // Frise sans repères numérotés (réservés à l'espace client).
    expect(timeline.querySelector('.mk')).toBeNull();
  });

  it('la page publique n’appelle aucune donnée de dossier', async () => {
    const api = renderPublicHome();
    await waitFor(() => expect(screen.getByText('Aucun programme publié pour le moment.')).toBeInTheDocument());
    const called = (Object.keys(api) as (keyof ApiClient)[])
      .filter((key) => vi.isMockFunction(api[key]) && (api[key] as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(called.length).toBeGreaterThan(0);
    expect(called.filter((key) => !PUBLIC_CALLS.has(key))).toEqual([]);
  });
});
