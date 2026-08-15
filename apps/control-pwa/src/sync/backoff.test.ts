import { describe, expect, it } from 'vitest';

import { computeBackoffDelayMs, computeNextRetryAt } from './backoff';

describe('computeBackoffDelayMs — backoff exponentiel, jamais un abandon', () => {
  it('vaut 0 sans tentative échouée', () => {
    expect(computeBackoffDelayMs(0)).toBe(0);
  });

  it('double à chaque tentative', () => {
    expect(computeBackoffDelayMs(1)).toBe(2000);
    expect(computeBackoffDelayMs(2)).toBe(4000);
    expect(computeBackoffDelayMs(3)).toBe(8000);
    expect(computeBackoffDelayMs(4)).toBe(16000);
  });

  it('est plafonné, jamais un délai indéfiniment croissant', () => {
    expect(computeBackoffDelayMs(20)).toBe(60000);
  });
});

describe('computeNextRetryAt', () => {
  it('additionne le délai de backoff à l\'instant fourni', () => {
    const now = new Date('2026-08-15T10:00:00.000Z');
    expect(computeNextRetryAt(1, now)).toBe('2026-08-15T10:00:02.000Z');
  });
});
