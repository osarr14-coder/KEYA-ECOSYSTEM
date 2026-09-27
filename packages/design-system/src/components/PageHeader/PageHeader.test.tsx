import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from './PageHeader';

describe('PageHeader — en-tête de page commun (ticket F-073)', () => {
  it('rend le titre en <h1>, le surtitre, le sous-titre et les actions', () => {
    render(
      <PageHeader
        eyebrow="Résidence Démonstration"
        title="Lot A1"
        subtitle="Suivi de votre acquisition"
        actions={<button type="button">Payer</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Lot A1' })).toBeInTheDocument();
    expect(screen.getByText('Résidence Démonstration')).toBeInTheDocument();
    expect(screen.getByText('Suivi de votre acquisition')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeInTheDocument();
  });

  it('sans surtitre ni actions, seul le titre est rendu', () => {
    const { container } = render(<PageHeader title="À faire" />);
    expect(screen.getByRole('heading', { level: 1, name: 'À faire' })).toBeInTheDocument();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
