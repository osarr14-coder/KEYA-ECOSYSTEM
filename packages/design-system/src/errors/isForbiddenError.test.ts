import { describe, expect, it } from 'vitest';

import { isForbiddenError } from './isForbiddenError';

describe('isForbiddenError', () => {
  it('reconnaît une erreur avec status 403', () => {
    expect(isForbiddenError({ status: 403 })).toBe(true);
  });

  it.each([401, 404, 500, undefined])('rejette un status %s différent de 403', (status) => {
    expect(isForbiddenError({ status })).toBe(false);
  });

  it.each([null, undefined, 'erreur réseau', 42, new Error('boom')])(
    'rejette une valeur non structurée %s',
    (value) => {
      expect(isForbiddenError(value)).toBe(false);
    },
  );
});
