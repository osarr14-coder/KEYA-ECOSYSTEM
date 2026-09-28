import { render, screen } from '@testing-library/react';
import { resetDemoInstanceCache } from '@keya/design-system';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignSystemGalleryRoute } from './DesignSystemGallery';

function stubInstance(environment: string | null) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      instance: environment === null ? null : {
        code: 'DEMO-CI-TEST', dataset_version: 'DEMO-CI-v1', environment, status: 'ACTIVE',
      },
    }),
  }));
}

describe('Galerie /design-system (PO-2026-09-27-20, A-DS-3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDemoInstanceCache();
  });

  it('en environnement DÉMO : chaque famille de composants est présentée', async () => {
    stubInstance('DEMO');
    render(<DesignSystemGalleryRoute />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Galerie du design system' })).toBeInTheDocument();
    for (const title of [
      'Couleurs', 'Typographie', 'Marquage démonstration et simulation', 'Boutons et actions', 'Champs de formulaire',
      'États de travail — badges compacts', 'Niveaux de confiance — échelle', 'Montants, dates, références', 'Traçabilité',
      'Indicateurs et chiffres clés', 'États d’écran', 'Navigation et parcours', 'Icônes',
      // Adapté selon PO-2026-09-28-29 (E) : nouvelle famille de la galerie.
      'Jalons — jauge segmentée et façade-jauge',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('Bien bloqué')).toBeInTheDocument();
    expect(screen.getByText('Signé (simulé)')).toBeInTheDocument();
    expect(screen.getAllByText('Non applicable').length).toBeGreaterThan(0);
    expect(screen.getByTestId('archive-banner')).toBeInTheDocument();
  });

  it('PO-2026-09-28-29 : jauge (7 états, carte et compacte) et façade-jauge (tous les états, par partie)', async () => {
    stubInstance('DEMO');
    render(<DesignSystemGalleryRoute />);
    const card = await screen.findByRole('list', { name: 'Jauge de démonstration — 7 états' });
    expect(card.querySelectorAll('[data-testid="gauge-segment"]')).toHaveLength(7);
    const compact = screen.getByRole('list', { name: 'Jauge compacte de démonstration' });
    expect(compact.querySelectorAll('[data-testid="gauge-segment"]')).toHaveLength(7);
    expect(screen.getAllByTestId('gallery-facade-fondations')).toHaveLength(7);
    expect(screen.getAllByTestId('gallery-facade-elevation')).toHaveLength(7);
  });

  it('hors environnement DÉMO : galerie refusée', async () => {
    stubInstance('PROD');
    render(<DesignSystemGalleryRoute />);
    expect(await screen.findByRole('heading', { name: 'Galerie indisponible' })).toBeInTheDocument();
    expect(screen.queryByText('Galerie du design system')).not.toBeInTheDocument();
  });

  it('sans instance de démonstration : galerie refusée', async () => {
    stubInstance(null);
    render(<DesignSystemGalleryRoute />);
    expect(await screen.findByRole('heading', { name: 'Galerie indisponible' })).toBeInTheDocument();
  });
});
