import { afterEach, describe, expect, it, vi } from 'vitest';

import { setViewedArchive } from './archiveView';
import { ApiError, createApiClient } from './client';

/** Lot 5 (PO-2026-09-29-01, -02) — le client API lit l'archive choisie et
 * n'y tente aucune écriture. */
describe('client API et archive consultée', () => {
  afterEach(() => {
    setViewedArchive(null);
    vi.unstubAllGlobals();
  });

  it('envoie le code de l’archive en lecture', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    setViewedArchive({ code: 'DEMO-CI-ANCIENNE', archived_at: null });

    await createApiClient({ baseUrl: '', getAccessToken: () => 'jeton' }).listReservations();

    expect(fetchMock.mock.calls[0][1].headers['X-Demo-Instance-View']).toBe('DEMO-CI-ANCIENNE');
  });

  it('refuse toute écriture sans l’envoyer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setViewedArchive({ code: 'DEMO-CI-ANCIENNE', archived_at: null });

    const attempt = createApiClient({ baseUrl: '', getAccessToken: () => 'jeton' }).archiveInstance('DEMO-CI-ANCIENNE');

    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ status: 409, detail: expect.stringContaining('lecture seule') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sans archive : instance active, aucun en-tête', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await createApiClient({ baseUrl: '', getAccessToken: () => 'jeton' }).listReservations();

    expect(fetchMock.mock.calls[0][1].headers['X-Demo-Instance-View']).toBeUndefined();
  });
});
