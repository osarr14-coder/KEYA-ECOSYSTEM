import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoBanner, resetDemoInstanceCache } from './DemoBanner';

describe('DemoBanner (audit M01/M02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDemoInstanceCache();
  });

  it('affiche toujours le marquage, même sans réponse de l’API', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('hors ligne'))));
    render(<DemoBanner apiBaseUrl="http://api" />);
    expect(screen.getByTestId('demo-banner')).toHaveTextContent('DÉMONSTRATION — DONNÉES FICTIVES');
    expect(screen.getByRole('note', { name: 'DÉMONSTRATION — DONNÉES FICTIVES' })).toBeInTheDocument();
  });

  it('ajoute l’identifiant d’instance servi par l’API publique', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ instance: { code: 'DEMO-CI-20260927-AB12', dataset_version: 'DEMO-CI-v1', environment: 'DEMO' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DemoBanner apiBaseUrl="http://api" />);
    await waitFor(() => expect(screen.getByTestId('demo-banner-instance')).toHaveTextContent('Instance DEMO-CI-20260927-AB12'));
    expect(fetchMock).toHaveBeenCalledWith('http://api/api/public/demo-instance/');
    expect(screen.getByRole('note', { name: 'DÉMONSTRATION — DONNÉES FICTIVES, instance DEMO-CI-20260927-AB12' })).toBeInTheDocument();
  });

  it('n’utilise ni le doré de marque ni une couleur en dur hors hachure', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    render(<DemoBanner apiBaseUrl="http://api" />);
    const style = screen.getByTestId('demo-banner').getAttribute('style') ?? '';
    expect(style).toContain('var(--keya-neutral-heading)');
    expect(style).not.toMatch(/accent|#C49A2C|#E2C47A/i);
  });
});
