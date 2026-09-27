import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '../Button/Button';
import { ReserveCard } from './ReserveCard';

describe('ReserveCard (PO-2026-09-27-20, §10)', () => {
  it('affiche état, auteur, motif, action attendue, correction et décision ; action interdite expliquée', () => {
    render(
      <ReserveCard
        state="open"
        title="Fissure en pied de mur"
        openedAt="2026-09-27T10:00:00Z"
        openedBy="Contrôleur Démo"
        reason="Fissure de 3 mm"
        expectedAction="Reprendre l'enduit et photographier"
        actions={<Button type="button" disabled>Lever la réserve</Button>}
        actionNote="Seul le bureau de contrôle peut lever une réserve."
      />,
    );
    const card = screen.getByTestId('reserve-card');
    expect(card).toHaveTextContent('Ouverte');
    expect(card).toHaveTextContent('Contrôleur Démo');
    expect(card).toHaveTextContent('Fissure de 3 mm');
    expect(card).toHaveTextContent("Reprendre l'enduit et photographier");
    expect(card).toHaveTextContent('Aucune pour le moment');
    expect(card).toHaveTextContent('En attente');
    expect(screen.getByRole('button', { name: 'Lever la réserve' })).toBeDisabled();
    expect(card).toHaveTextContent('Seul le bureau de contrôle peut lever une réserve.');
  });
});
