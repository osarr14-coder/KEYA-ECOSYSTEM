import { describe, expect, it } from 'vitest';

import { MOBILE_BREAKPOINT_PX } from './breakpoints';

describe('breakpoints (ticket F-050)', () => {
  it('expose un seuil mobile en pixels', () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(640);
  });
});
