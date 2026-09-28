import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(
  'createApiClient — organisation active (ticket 019) : le header X-Organization-Id '
  + 'reflète toujours getActiveOrganizationId, jamais une valeur figée au démarrage',
  () => {
    it('aucun header X-Organization-Id tant que getActiveOrganizationId retourne null', async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse([]));
      vi.stubGlobal('fetch', fetchMock);

      const client = createApiClient({
        baseUrl: 'http://api.test', getAccessToken: () => null, getActiveOrganizationId: () => null,
      });
      await client.getMyLots();

      const [, init] = fetchMock.mock.calls[0];
      expect((init?.headers as Record<string, string>)['X-Organization-Id']).toBeUndefined();
    });

    it('transmet X-Organization-Id sur CHAQUE requête dès que getActiveOrganizationId en renvoie une', async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse([]));
      vi.stubGlobal('fetch', fetchMock);

      const client = createApiClient({
        baseUrl: 'http://api.test', getAccessToken: () => null,
        getActiveOrganizationId: () => 'org-42',
      });
      await client.getMyLots();
      await client.getMyTasks();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [, init] of fetchMock.mock.calls) {
        expect((init?.headers as Record<string, string>)['X-Organization-Id']).toBe('org-42');
      }
    });

    it(
      'relit getActiveOrganizationId à CHAQUE appel — un changement d\'organisation entre '
      + 'deux requêtes est immédiatement reflété, jamais une valeur capturée une seule fois',
      async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse([]));
        vi.stubGlobal('fetch', fetchMock);

        let activeOrganizationId = 'org-1';
        const client = createApiClient({
          baseUrl: 'http://api.test', getAccessToken: () => null,
          getActiveOrganizationId: () => activeOrganizationId,
        });

        await client.getMyLots();
        activeOrganizationId = 'org-2';
        await client.getMyLots();

        const headers = fetchMock.mock.calls.map(
          ([, init]) => (init?.headers as Record<string, string>)['X-Organization-Id'],
        );
        expect(headers).toEqual(['org-1', 'org-2']);
      },
    );
  },
);

describe('createApiClient — onUnauthorized (ticket F-033, vague 4)', () => {
  it('un 401 en cours de session appelle onUnauthorized', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: 'Jeton invalide ou expiré.' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const onUnauthorized = vi.fn();

    const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'dead-token', onUnauthorized });

    await expect(client.getMe()).rejects.toMatchObject({ status: 401 } satisfies Partial<ApiError>);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it.each([200, 403, 404, 500])('un status %s n\'appelle jamais onUnauthorized', async (status) => {
    const fetchMock = vi.fn(async () => jsonResponse({}, status));
    vi.stubGlobal('fetch', fetchMock);
    const onUnauthorized = vi.fn();

    const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'token', onUnauthorized });
    await client.getMe().catch(() => undefined);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('createApiClient — rafraîchissement après une action (PO-2026-09-28-51)', () => {
  it('publie « données changées » après une écriture réussie, jamais après une lecture ni un refus', async () => {
    const listener = vi.fn();
    window.addEventListener('keya:data-changed', listener);
    const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'token' });
    try {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 'r-1' })));
      await client.getMe();
      expect(listener).not.toHaveBeenCalled();

      await client.createProgramRequest('Projet fictif');
      expect(listener).toHaveBeenCalledTimes(1);

      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'refus' }, 409)));
      await expect(client.createProgramRequest('Projet fictif')).rejects.toBeInstanceOf(ApiError);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keya:data-changed', listener);
    }
  });
});
