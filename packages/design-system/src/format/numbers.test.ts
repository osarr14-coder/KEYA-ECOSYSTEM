import { describe, expect, it } from 'vitest';

import { formatMoney, formatSurface, pluralize } from './numbers';

describe('Formateurs partagés (PO-2026-09-27-20, DESIGN_SYSTEM §9)', () => {
  it('montant en entiers XOF, espace fine insécable, devise visible', () => {
    expect(formatMoney('30000000.00')).toBe('30 000 000 XOF');
    expect(formatMoney(0)).toBe('0 XOF');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(-1500)).toBe('−1 500 XOF');
  });

  it('surface sans décimales inutiles (X01)', () => {
    expect(formatSurface('75.00')).toBe('75 m²');
    expect(formatSurface('82.50')).toBe('82,5 m²');
    expect(formatSurface(null)).toBeNull();
  });

  it('accord réel, jamais « lot(s) » (X02)', () => {
    expect(pluralize(1, 'lot')).toBe('1 lot');
    expect(pluralize(2, 'lot')).toBe('2 lots');
    expect(pluralize(0, 'lot')).toBe('0 lot');
  });
});
