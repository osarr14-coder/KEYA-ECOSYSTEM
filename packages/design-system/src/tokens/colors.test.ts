import { describe, expect, it } from 'vitest';

import { semanticColors } from './colors';

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
