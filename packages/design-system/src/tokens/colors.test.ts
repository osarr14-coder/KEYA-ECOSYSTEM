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

describe('semanticColors', () => {
  it('expose une palette "alerte" complète (background/border/icon/text)', () => {
    expect(semanticColors.alert.background).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(semanticColors.alert.border).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(semanticColors.alert.icon).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(semanticColors.alert.text).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('background et texte restent distincts pour rester lisibles', () => {
    expect(semanticColors.alert.background).not.toBe(semanticColors.alert.text);
  });
});
