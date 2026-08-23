import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { semanticColors } from '../../tokens/colors';
import { Input } from './Input';

describe('Input', () => {
  it('rend un <input> natif avec la bordure neutre au repos', () => {
    render(<Input aria-label="Rechercher" />);
    const input = screen.getByLabelText('Rechercher');
    expect(input.tagName).toBe('INPUT');
    // Ticket F-051 — `element.style.border` (pas `toHaveStyle`/
    // `getComputedStyle`) : `semanticColors.neutral.border` référence
    // désormais var(--keya-*) (mode sombre), et `getComputedStyle` de
    // jsdom (environnement de test) ne resérialise pas fiablement un
    // shorthand `border` contenant un var() non résolu selon l'ordre des
    // AUTRES propriétés du même style inline (constat empirique — sans
    // lien avec le rendu réel du navigateur, où `var()` se résout
    // normalement en shorthand, vérifié séparément). Lire le style
    // INLINE directement contourne cette limite de jsdom.
    expect(input.style.border).toBe(`1px solid ${semanticColors.neutral.border}`);
  });

  it('porte la classe partagée qui pilote le focus visible (GlobalStyles)', () => {
    render(<Input aria-label="Rechercher" />);
    expect(screen.getByLabelText('Rechercher')).toHaveClass('keya-input');
  });

  it('transmet value/onChange/type/placeholder comme un <input> natif', () => {
    const onChange = vi.fn();
    render(<Input aria-label="Rechercher" type="search" value="abc" onChange={onChange} placeholder="Email…" />);
    const input = screen.getByLabelText('Rechercher') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveAttribute('placeholder', 'Email…');
    expect(input.value).toBe('abc');
    fireEvent.change(input, { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('un style explicite passé en prop reste prioritaire', () => {
    render(<Input aria-label="Rechercher" style={{ borderColor: '#123456' }} />);
    expect(screen.getByLabelText('Rechercher')).toHaveStyle({ borderColor: '#123456' });
  });

  it('fusionne une className fournie avec "keya-input", sans l\'écraser', () => {
    render(<Input aria-label="Rechercher" className="custom-class" />);
    const input = screen.getByLabelText('Rechercher');
    expect(input).toHaveClass('keya-input');
    expect(input).toHaveClass('custom-class');
  });
});
