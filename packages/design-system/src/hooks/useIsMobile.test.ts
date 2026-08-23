import { act, renderHook } from '@testing-library/react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';

import { useIsMobile } from './useIsMobile';

/**
 * `jsdom` n'implémente pas `window.matchMedia` (vérifié dans ce projet,
 * voir `useIsMobile.ts`) — un mock minimal, avec un `dispatch` explicite
 * pour simuler un changement de viewport, même esprit que
 * `useOnlineStatus.test.ts` (`setNavigatorOnLine`).
 */
function mockMatchMedia(initialMatches: boolean) {
  let changeHandler: ((event: MediaQueryListEvent) => void) | undefined;
  const mediaQueryList = {
    matches: initialMatches,
    media: '(max-width: 640px)',
    addEventListener: vi.fn((event: string, handler: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') changeHandler = handler;
    }),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList;

  window.matchMedia = vi.fn().mockReturnValue(mediaQueryList);

  return {
    mediaQueryList,
    dispatch(matches: boolean) {
      (mediaQueryList as { matches: boolean }).matches = matches;
      changeHandler?.({ matches } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  // @ts-expect-error — retire le mock, jsdom n'a pas matchMedia nativement.
  delete window.matchMedia;
});

describe('useIsMobile (ticket F-050)', () => {
  it('lit matchMedia à l\'initialisation (viewport déjà mobile)', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('lit matchMedia à l\'initialisation (viewport déjà desktop)', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('se met à jour sur un changement de viewport (redimensionnement)', () => {
    const { dispatch } = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      dispatch(true);
    });

    expect(result.current).toBe(true);
  });

  it('retire son listener au démontage', () => {
    const { mediaQueryList } = mockMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());

    expect(mediaQueryList.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    unmount();

    expect(mediaQueryList.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('retourne false sans exception si matchMedia est absent (jsdom réel de ce projet)', () => {
    // Pas de mockMatchMedia ici — reproduit l'environnement de test réel
    // de ce projet (voir setupTests.ts), où window.matchMedia est undefined.
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
