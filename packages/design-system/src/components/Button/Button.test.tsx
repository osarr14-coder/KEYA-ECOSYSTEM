import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { semanticColors } from '../../tokens/colors';
import { Button } from './Button';

describe('Button — variantes', () => {
  it('rend un <button> natif, variante primary par défaut', () => {
    render(<Button>Valider</Button>);
    const button = screen.getByRole('button', { name: 'Valider' });
    expect(button).toHaveStyle({ background: semanticColors.neutral.text, color: '#FFFFFF' });
  });

  it('variante secondary : fond transparent, bordure neutre, texte encre', () => {
    render(<Button variant="secondary">Annuler</Button>);
    const button = screen.getByRole('button', { name: 'Annuler' });
    expect(button).toHaveStyle({ background: 'transparent', color: semanticColors.neutral.text });
    expect(button).toHaveStyle({ borderColor: semanticColors.neutral.border });
  });

  it('variante danger : réutilise le token dédié, jamais la couleur "alert"', () => {
    render(<Button variant="danger">Confirmer la désactivation</Button>);
    const button = screen.getByRole('button', { name: 'Confirmer la désactivation' });
    expect(button).toHaveStyle({ background: semanticColors.danger.border, color: '#FFFFFF' });
    expect(button).not.toHaveStyle({ background: semanticColors.alert.border });
  });
});

describe('Button — accessibilité et comportement', () => {
  it('applique une cible tactile ≥44px de hauteur (WCAG 2.5.5)', () => {
    render(<Button>Rechercher</Button>);
    expect(screen.getByRole('button', { name: 'Rechercher' })).toHaveStyle({ minHeight: '44px' });
  });

  it('porte la classe partagée qui pilote le focus visible/hover (GlobalStyles)', () => {
    render(<Button>Rechercher</Button>);
    expect(screen.getByRole('button', { name: 'Rechercher' })).toHaveClass('keya-btn');
  });

  it('respecte disabled — jamais cliquable, onClick non appelé', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Confirmer</Button>);
    const button = screen.getByRole('button', { name: 'Confirmer' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('transmet type/onClick/aria-label comme un <button> natif', () => {
    const onClick = vi.fn();
    render(<Button type="submit" aria-label="Envoyer le formulaire" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Envoyer le formulaire' });
    expect(button).toHaveAttribute('type', 'submit');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('un style explicite passé en prop reste prioritaire sur la variante', () => {
    render(<Button style={{ background: '#123456' }}>Test</Button>);
    expect(screen.getByRole('button', { name: 'Test' })).toHaveStyle({ background: '#123456' });
  });

  it('fusionne une className fournie avec "keya-btn", sans l\'écraser', () => {
    render(<Button className="custom-class">Test</Button>);
    const button = screen.getByRole('button', { name: 'Test' });
    expect(button).toHaveClass('keya-btn');
    expect(button).toHaveClass('custom-class');
  });
});
