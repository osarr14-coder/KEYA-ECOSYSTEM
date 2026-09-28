import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DATA_CHANGED_EVENT, LIVE_REFRESH_INTERVAL_MS, notifyDataChanged, useApiResource } from './useApiResource';

/** PO-2026-09-28-51 (A2) — rafraîchissement immédiat après une action, au
 * retour sur la fenêtre et toutes les 15 s, sans repasser par
 * « chargement ». */
function counterLoad() {
  let calls = 0;
  const load = vi.fn(async () => {
    calls += 1;
    return { version: calls };
  });
  return load;
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('useApiResource — rafraîchissement discret (PO-2026-09-28-51)', () => {
  it('recharge après une action (événement « données changées ») sans repasser par le chargement', async () => {
    const load = counterLoad();
    const { result } = renderHook(() => useApiResource(load, []));
    await waitFor(() => expect(result.current.status).toBe('success'));
    const states: string[] = [];

    act(() => notifyDataChanged());
    states.push(result.current.status);
    await waitFor(() => expect(result.current).toMatchObject({ status: 'success', data: { version: 2 } }));

    expect(states).toEqual(['success']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('recharge au retour sur la fenêtre', async () => {
    const load = counterLoad();
    const { result } = renderHook(() => useApiResource(load, []));
    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current).toMatchObject({ status: 'success', data: { version: 2 } }));
  });

  it('recharge toutes les 15 s tant que l’onglet est visible, jamais onglet masqué', async () => {
    // Horloge simulée installée AVANT le rendu (l'intervalle est armé au
    // montage) ; les attentes se font par `act`, pas par `waitFor`, dont le
    // sondage utiliserait lui aussi l'horloge simulée.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const load = counterLoad();
    const { result } = renderHook(() => useApiResource(load, []));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe('success');

    await act(async () => {
      vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      vi.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 2);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('garde les données affichées si un rafraîchissement discret échoue', async () => {
    const load = vi.fn().mockResolvedValueOnce({ version: 1 }).mockRejectedValueOnce(new Error('réseau'));
    const { result } = renderHook(() => useApiResource(load, []));
    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => {
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    expect(result.current).toMatchObject({ status: 'success', data: { version: 1 } });
  });

  it('garde le même objet quand le contenu n’a pas changé (aucun nouveau rendu)', async () => {
    const load = vi.fn(async () => ({ label: 'identique' }));
    const { result } = renderHook(() => useApiResource(load, []));
    await waitFor(() => expect(result.current.status).toBe('success'));
    const first = result.current.status === 'success' ? result.current.data : null;

    act(() => notifyDataChanged());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    expect(result.current.status === 'success' ? result.current.data : null).toBe(first);
  });

  it('n’écoute plus rien une fois démonté', async () => {
    const load = counterLoad();
    const { result, unmount } = renderHook(() => useApiResource(load, []));
    await waitFor(() => expect(result.current.status).toBe('success'));
    unmount();

    notifyDataChanged();

    expect(load).toHaveBeenCalledTimes(1);
  });
});
