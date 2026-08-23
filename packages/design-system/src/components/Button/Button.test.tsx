import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { semanticColors } from '../../tokens/colors';
import { Button } from './Button';

describe('Button — variantes', () => {
  it('rend un <button> natif, variante primary par défaut', () => {
    render(<Button>Valider</Button>);
    const button = screen.getByRole('button', { name: 'Valider' });
    // Ticket F-051 — `color: semanticColors.neutral.surface`, PAS un
    // `#FFFFFF` figé : `neutral.text` (le fond de ce bouton) s'inverse de
    // teinte en mode sombre, le texte doit s'inverser AVEC lui pour
    // rester lisible — vérifié en navigateur réel (capture claire ET
    // sombre) avant ce correctif. En clair, `neutral.surface` VAUT
    // `#FFFFFF` (comportement visuel strictement inchangé), mais ce n'est
    // plus la même VALEUR DE TOKEN qu'avant ce ticket.
    expect(button).toHaveStyle({ background: semanticColors.neutral.text, color: semanticColors.neutral.surface });
  });

  it('variante secondary : fond transparent, bordure neutre, texte encre', () => {
    render(<Button variant="secondary">Annuler</Button>);
    const button = screen.getByRole('button', { name: 'Annuler' });
    expect(button).toHaveStyle({ background: 'transparent', color: semanticColors.neutral.text });
    // Ticket F-051 — style inline direct, pas toHaveStyle/getComputedStyle
    // (voir Input.test.tsx) : `getComputedStyle` de jsdom ne resérialise
    // pas fiablement un shorthand `border` contenant un var() non résolu
    // selon l'ordre des autres propriétés du même style inline — constat
    // empirique qui touchait DÉJÀ ce test précis (l'ordre actuel de
    // `VARIANT_STYLE` le faisait passer par coïncidence, un futur
    // réordonnancement de Button.tsx aurait pu le casser silencieusement).
    expect(button.style.border).toBe(`1px solid ${semanticColors.neutral.border}`);
  });

  it('variante danger : réutilise le token dédié, jamais la couleur "alert"', () => {
    render(<Button variant="danger">Confirmer la désactivation</Button>);
    const button = screen.getByRole('button', { name: 'Confirmer la désactivation' });
    // Ticket F-051 — `danger.solid`, PAS `danger.border` : ce dernier
    // s'inverse de teinte en mode sombre (rouge clair, calibré pour du
    // texte SUR un fond sombre), illisible en remplissage solide de
    // bouton avec un texte blanc fixe — `danger.solid` reste
    // volontairement figé entre thèmes (voir sa docstring, tokens/colors.ts).
    expect(button).toHaveStyle({ background: semanticColors.danger.solid, color: '#FFFFFF' });
    expect(button).not.toHaveStyle({ background: semanticColors.alert.border });
    expect(button).not.toHaveStyle({ background: semanticColors.danger.border });
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
