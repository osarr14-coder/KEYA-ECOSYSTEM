import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TabBar } from './TabBar';

const TABS = [
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'all_lots', label: 'Tous les lots' },
];

describe('TabBar — état actif visuellement distinct (ticket 023)', () => {
  it('pose aria-current="page" UNIQUEMENT sur l\'onglet actif', () => {
    render(<TabBar tabs={TABS} activeTabId="exceptions" onChange={() => {}} aria-label="Sections BUILD" />);

    expect(screen.getByRole('button', { name: 'Exceptions' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Tous les lots' })).not.toHaveAttribute('aria-current');
  });

  it('l\'onglet actif a un style RÉELLEMENT distinct (pas seulement aria-current)', () => {
    render(<TabBar tabs={TABS} activeTabId="exceptions" onChange={() => {}} aria-label="Sections BUILD" />);

    const active = screen.getByRole('button', { name: 'Exceptions' });
    const inactive = screen.getByRole('button', { name: 'Tous les lots' });
    expect(active).toHaveStyle({ fontWeight: '600' });
    expect(inactive).toHaveStyle({ fontWeight: '400' });
  });

  it('appelle onChange avec l\'id de l\'onglet cliqué', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={TABS} activeTabId="exceptions" onChange={onChange} aria-label="Sections BUILD" />);

    fireEvent.click(screen.getByRole('button', { name: 'Tous les lots' }));

    expect(onChange).toHaveBeenCalledWith('all_lots');
  });

  it('nomme la navigation selon aria-label', () => {
    render(<TabBar tabs={TABS} activeTabId="exceptions" onChange={() => {}} aria-label="Sections BUILD" />);
    expect(screen.getByRole('navigation', { name: 'Sections BUILD' })).toBeInTheDocument();
  });
});
