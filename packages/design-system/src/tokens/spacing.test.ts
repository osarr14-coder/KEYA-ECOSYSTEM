import { describe, expect, it } from 'vitest';

import { spacing } from './spacing';

describe('spacing', () => {
  it('expose exactement les 6 paliers attendus (xs à xxl)', () => {
    expect(Object.keys(spacing).sort()).toEqual(['lg', 'md', 'sm', 'xl', 'xs', 'xxl']);
  });

  it('chaque palier est un multiple exact de l\'unité de base 4px, jamais une valeur arbitraire', () => {
    for (const value of Object.values(spacing)) {
      const px = parseFloat(value);
      expect(value.endsWith('px')).toBe(true);
      expect(px % 4).toBe(0);
    }
  });

  it('les paliers sont strictement croissants (xs < sm < md < lg < xl < xxl)', () => {
    const ordered = [spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl, spacing.xxl]
      .map((value) => parseFloat(value));

    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
  });
});
