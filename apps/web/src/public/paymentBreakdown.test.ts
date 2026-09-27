import { describe, expect, it } from 'vitest';

import { paymentBreakdown } from './paymentBreakdown';

const SCHEDULE = {
  reservation_fee: '100000',
  steps: [
    { code: 'reservation', label: 'Premier versement (réservation)', cumulative_cap_percent: '10.00' },
    { code: 'fondations', label: 'Fondations achevées', cumulative_cap_percent: '35.00' },
    { code: 'livraison', label: 'Livraison', cumulative_cap_percent: '100.00' },
  ],
};

describe('paymentBreakdown — échéancier du simulateur public (ticket F-079)', () => {
  it('frais, puis complément jusqu’au premier plafond (frais jamais comptés deux fois), puis paliers cumulés', () => {
    const rows = paymentBreakdown(30_000_000, SCHEDULE);
    expect(rows.map((row) => [row.key, row.amount])).toEqual([
      ['frais', 100_000],
      ['reservation', 2_900_000],
      ['fondations', 7_500_000],
      ['livraison', 19_500_000],
    ]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(30_000_000);
    expect(rows.map((row) => row.cumulativePercent)).toEqual([0.3, 10, 35, 100]);
  });

  it('le dernier palier solde le prix exact, sans reliquat d’arrondi', () => {
    const rows = paymentBreakdown(33_333_333, SCHEDULE);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(33_333_333);
  });

  it('sans barème actif : frais puis solde ; prix invalide : aucun échéancier', () => {
    expect(paymentBreakdown(1_000_000, { reservation_fee: '100000', steps: [] }).map((row) => row.amount)).toEqual([100_000, 900_000]);
    expect(paymentBreakdown(0, SCHEDULE)).toEqual([]);
    expect(paymentBreakdown(Number.NaN, SCHEDULE)).toEqual([]);
  });
});
