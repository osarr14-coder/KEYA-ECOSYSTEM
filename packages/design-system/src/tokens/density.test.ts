import { describe, expect, it } from 'vitest';

import { ALL_DENSITIES, densityTokens } from './density';

describe('densityTokens', () => {
  it('exposes exactly the two densités attendues (dense, confortable)', () => {
    expect(Object.keys(densityTokens).sort()).toEqual(['confortable', 'dense']);
    expect(ALL_DENSITIES.sort()).toEqual(['confortable', 'dense']);
  });

  it('la densité dense est strictement plus compacte que confortable sur chaque token dimensionnel', () => {
    const dimensionalKeys: Array<keyof (typeof densityTokens)['dense']> = [
      'rowHeight', 'paddingInline', 'paddingBlock', 'fontSize', 'gap',
    ];
    for (const key of dimensionalKeys) {
      const denseValue = parseFloat(densityTokens.dense[key]);
      const confortableValue = parseFloat(densityTokens.confortable[key]);
      expect(denseValue).toBeLessThan(confortableValue);
    }
  });
});
