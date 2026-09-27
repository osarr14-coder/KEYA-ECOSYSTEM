import { describe, expect, it } from 'vitest';

import { formatCalendarDate, formatServerDateTime } from './dates';

describe('formats de date uniques (audit F06)', () => {
  it('horodatage : jour abrégé, heure et fuseau d’Abidjan', () => {
    expect(formatServerDateTime('2026-09-27T11:48:05Z')).toBe('27 sept. 2026, 11:48 (GMT, Abidjan)');
  });

  it('jour calendaire : jamais au format technique AAAA-MM-JJ', () => {
    expect(formatCalendarDate('2026-09-28')).toBe('28 sept. 2026');
  });

  it('valeur illisible : restituée telle quelle plutôt qu’une date fausse', () => {
    expect(formatServerDateTime('n/a')).toBe('n/a');
  });
});
