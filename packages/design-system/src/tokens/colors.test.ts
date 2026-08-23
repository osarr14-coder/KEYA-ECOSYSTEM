import { describe, expect, it } from 'vitest';

import { brandColors, semanticColors } from './colors';

describe('brandColors — identité de marque KEYIMMO AFRIC (ticket F-039)', () => {
  it('expose exactement navy et gold, aucune valeur supplémentaire', () => {
    expect(brandColors.navy).toBe('#0B1D3A');
    expect(brandColors.gold).toBe('#C49A2C');
    expect(Object.keys(brandColors).sort()).toEqual(['gold', 'navy']);
  });

  it('reste un groupe SÉPARÉ de semanticColors, jamais fusionné dedans', () => {
    expect(semanticColors).not.toHaveProperty('navy');
    expect(semanticColors).not.toHaveProperty('gold');
    expect(semanticColors).not.toHaveProperty('brand');
  });
});

/**
 * Ticket F-051 — mode sombre : `semanticColors` référence désormais des
 * variables CSS (`var(--keya-*)`), plus des hex littéraux (voir la
 * docstring de `colors.ts`). Les valeurs RÉELLES (claires ET sombres) sont
 * vérifiées à la source dans `GlobalStyles.test.tsx` (où `:root`/
 * `[data-theme]` sont réellement définis), pas ici — ce fichier vérifie
 * uniquement que chaque token référence bien UNE variable CSS namespacée
 * `--keya-`, jamais une valeur hex recopiée ou oubliée en clair.
 */
describe('semanticColors', () => {
  it('expose une palette "alerte" complète, chaque champ référence une variable CSS --keya-*', () => {
    expect(semanticColors.alert.background).toBe('var(--keya-alert-background)');
    expect(semanticColors.alert.border).toBe('var(--keya-alert-border)');
    expect(semanticColors.alert.icon).toBe('var(--keya-alert-icon)');
    expect(semanticColors.alert.text).toBe('var(--keya-alert-text)');
  });

  it('background et texte restent des variables DISTINCTES (jamais la même couleur)', () => {
    expect(semanticColors.alert.background).not.toBe(semanticColors.alert.text);
  });

  it('aucun champ semanticColors ne recopie plus une valeur hex littérale', () => {
    const flat = [
      ...Object.values(semanticColors.alert),
      ...Object.values(semanticColors.danger),
      ...Object.values(semanticColors.neutral),
      ...Object.values(semanticColors.progress),
    ];
    flat.forEach((value) => {
      expect(value).toMatch(/^var\(--keya-[\w-]+\)$/);
    });
  });
});
