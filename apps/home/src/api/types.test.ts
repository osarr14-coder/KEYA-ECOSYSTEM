import { describe, expect, it } from 'vitest';

import { toTrustEventData } from './types';

describe('toTrustEventData', () => {
  it('reformate les clés snake_case en camelCase sans changer aucune valeur', () => {
    const raw = {
      level: 'controle' as const,
      source: 'inspection_terrain',
      actor: 'inspecteur@example.com',
      scope: 'Lot A12',
      created_at: '2026-03-05T10:30:00Z',
    };

    const mapped = toTrustEventData(raw);

    expect(mapped).toEqual({
      level: 'controle',
      source: 'inspection_terrain',
      actor: 'inspecteur@example.com',
      scope: 'Lot A12',
      createdAt: '2026-03-05T10:30:00Z',
    });
  });
});
