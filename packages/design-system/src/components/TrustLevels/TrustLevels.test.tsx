import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TrustLevels } from './TrustLevels';

describe('TrustLevels — échelle des niveaux de confiance (PO-2026-09-27-20, §8.1)', () => {
  it('affiche les cinq niveaux, atteints avec qui/quand/version/périmètre, non atteints vides', () => {
    render(
      <TrustLevels
        reached={{
          declared: { by: 'Constructeur Démo', role: 'Constructeur', at: '2026-09-27T10:00:00Z', version: 'v1', scope: 'Jalon fondations, lot A1' },
          validated: { by: 'Bureau de contrôle Démo', role: 'Contrôleur', at: '2026-09-28T10:00:00Z', version: 'v2', scope: 'Jalon fondations, lot A1' },
        }}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByTestId('trust-level-declared')).toHaveAttribute('data-reached', 'true');
    // Adapté selon PO-2026-09-28-18 : « organisation · rôle », sans parenthèse.
    expect(screen.getByTestId('trust-level-declared')).toHaveTextContent('Constructeur Démo · Constructeur ·');
    expect(screen.getByTestId('trust-level-declared')).toHaveTextContent('v1');
    expect(screen.getByTestId('trust-level-declared')).toHaveTextContent('périmètre : Jalon fondations, lot A1');
    expect(screen.getByTestId('trust-level-documented')).toHaveTextContent('Non atteint');
    expect(screen.getByTestId('trust-level-validated')).toHaveTextContent('Validé techniquement — démonstration');
    expect(screen.getByTestId('trust-level-validated')).toHaveTextContent('Bureau de contrôle Démo · Contrôleur ·');
    expect(screen.getByRole('list').textContent).not.toMatch(/\((Constructeur|Contrôleur)\)|@/);
  });

  it('aucun score, aucun pourcentage', () => {
    const { container } = render(<TrustLevels reached={{ declared: { by: 'A', at: '2026-09-27T10:00:00Z', version: 'v1', scope: 'S' } }} />);
    expect(container.textContent).not.toMatch(/%|score|\/ ?5/i);
    expect(container.querySelector('progress, meter, [role="progressbar"]')).toBeNull();
  });
});
