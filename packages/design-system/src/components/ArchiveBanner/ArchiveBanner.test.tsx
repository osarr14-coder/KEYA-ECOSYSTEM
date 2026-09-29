import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ArchiveBanner } from './ArchiveBanner';

describe('ArchiveBanner (PO-2026-09-27-20, §7)', () => {
  it('affiche « ARCHIVE — LECTURE SEULE » dans la grammaire hachurée, sans couleur de statut ni doré', () => {
    render(<ArchiveBanner instanceCode="DEMO-CI-1" />);
    const banner = screen.getByTestId('archive-banner');
    expect(banner).toHaveTextContent('ARCHIVE — LECTURE SEULE');
    expect(banner).toHaveAttribute('aria-label', 'ARCHIVE — LECTURE SEULE, instance DEMO-CI-1');
    const style = banner.getAttribute('style') ?? '';
    expect(style).toContain('repeating-linear-gradient');
    expect(style).not.toMatch(/accent|alert|danger|success/);
  });

  it('lot 5 : dit quelle archive est lue et ramène à l’instance active', () => {
    const onReturn = vi.fn();
    render(<ArchiveBanner instanceCode="DEMO-CI-1" archivedAt="2026-09-29T08:00:00Z" onReturn={onReturn} />);
    expect(screen.getByTestId('archive-banner-identity')).toHaveTextContent('Instance DEMO-CI-1 · archivée le 29 sept. 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Revenir à l’instance active' }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
