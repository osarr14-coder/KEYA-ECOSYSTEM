import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
