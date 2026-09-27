import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Timeline } from './Timeline';

describe('Timeline — chronologie d\'audit (PO-2026-09-27-20, §10)', () => {
  it('affiche acteur, rôle, action, date serveur avec fuseau, motif et objet versionné, sans bouton', () => {
    render(
      <Timeline
        entries={[{
          id: 'e1', actor: 'Awa Koné', role: 'Gestionnaire', action: 'Contrat approuvé', at: '2026-09-27T14:05:00Z',
          justification: 'Pièces complètes', object: { label: 'Contrat lot A1', version: 'v2' },
        }]}
      />,
    );
    const entry = screen.getByTestId('timeline-entry');
    expect(entry).toHaveTextContent('Contrat approuvé');
    expect(entry).toHaveTextContent('Awa Koné · Gestionnaire');
    expect(entry).toHaveTextContent('27 sept. 2026, 14:05 (GMT, Abidjan)');
    expect(entry).toHaveTextContent('Motif : Pièces complètes');
    expect(entry).toHaveTextContent('v2');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('vide : phrase explicite', () => {
    render(<Timeline entries={[]} />);
    expect(screen.getByText('Aucun événement enregistré.')).toBeInTheDocument();
  });
});
