import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiErrorBanner } from './ApiErrorBanner';

describe('ApiErrorBanner', () => {
  it('affiche le titre générique + un bouton Réessayer pour une erreur qui n\'est pas un 403', () => {
    const onRetry = vi.fn();
    render(<ApiErrorBanner error={new Error('réseau indisponible')} title="Impossible de charger X." onRetry={onRetry} />);

    expect(screen.getByText('Impossible de charger X.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('affiche "Accès refusé", jamais de bouton Réessayer, pour un 403', () => {
    render(<ApiErrorBanner error={{ status: 403 }} title="Impossible de charger X." onRetry={vi.fn()} />);

    expect(screen.getByText('Accès refusé')).toBeInTheDocument();
    expect(screen.queryByText('Impossible de charger X.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  });

  it('un 401 n\'est PAS traité comme un 403 — reste le message générique', () => {
    render(<ApiErrorBanner error={{ status: 401 }} title="Impossible de charger X." onRetry={vi.fn()} />);

    expect(screen.getByText('Impossible de charger X.')).toBeInTheDocument();
    expect(screen.queryByText('Accès refusé')).not.toBeInTheDocument();
  });
});
