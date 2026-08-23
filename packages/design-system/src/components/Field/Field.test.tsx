import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../Input/Input';
import { Field } from './Field';

describe('Field — conteneur label + champ, source unique du libellé (ticket F-051)', () => {
  it('affiche le libellé visible', () => {
    render(<Field label="Taux (%)"><Input value="" onChange={() => {}} /></Field>);
    expect(screen.getByText('Taux (%)')).toBeInTheDocument();
  });

  it('dérive aria-label de la MÊME chaîne que le libellé visible — jamais deux sources qui divergent', () => {
    render(<Field label="Taux (%)"><Input value="" onChange={() => {}} /></Field>);
    expect(screen.getByLabelText('Taux (%)')).toBeInTheDocument();
  });

  it('un aria-label explicite passé à l\'enfant est ignoré au profit de celui de Field (une seule source)', () => {
    render(
      <Field label="Taux (%)">
        <Input aria-label="Autre libellé jamais affiché" value="" onChange={() => {}} />
      </Field>,
    );
    expect(screen.getByLabelText('Taux (%)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Autre libellé jamais affiché')).not.toBeInTheDocument();
  });

  it('associe le libellé et le champ via <label> englobant (accessible sans aria-label si le champ n\'en a pas besoin)', () => {
    const { container } = render(<Field label="Taux (%)"><Input value="" onChange={() => {}} /></Field>);
    expect(container.querySelector('label')).toContainElement(container.querySelector('input'));
  });

  it('width optionnel pose la largeur sur le conteneur, jamais sur l\'enfant directement', () => {
    const { container } = render(<Field label="Taux (%)" width="120px"><Input value="" onChange={() => {}} /></Field>);
    expect(container.querySelector('label')).toHaveStyle({ width: '120px' });
  });

  it('sans width, aucune largeur forcée (l\'enfant peut occuper toute la largeur disponible)', () => {
    const { container } = render(<Field label="Taux (%)"><Input value="" onChange={() => {}} /></Field>);
    expect(container.querySelector('label')!.style.width).toBe('');
  });
});
