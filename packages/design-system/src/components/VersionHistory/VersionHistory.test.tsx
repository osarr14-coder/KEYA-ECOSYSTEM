import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VersionHistory } from './VersionHistory';

describe('VersionHistory (PO-2026-09-27-20, §10)', () => {
  it('version courante en avant, versions antérieures conservées avec leurs avis', () => {
    render(
      <VersionHistory
        versions={[
          { id: 'v2', version: 'v2', statusLabel: 'Approuvé', at: '2026-09-28T10:00:00Z' },
          {
            id: 'v1', version: 'v1', statusLabel: 'En revue', at: '2026-09-27T10:00:00Z',
            reviews: [{ id: 'r1', author: 'Juriste Démo', verdict: 'Corrections demandées', at: '2026-09-27T12:00:00Z' }],
          },
        ]}
      />,
    );
    expect(screen.getByTestId('version-current')).toHaveTextContent('v2');
    const previous = screen.getByTestId('version-previous');
    expect(previous).toHaveTextContent('v1');
    expect(within(previous).getByRole('list', { name: 'Avis sur la version v1' })).toHaveTextContent('Corrections demandées');
    expect(screen.getByText(/Versions antérieures \(1\)/)).toBeInTheDocument();
  });
});
