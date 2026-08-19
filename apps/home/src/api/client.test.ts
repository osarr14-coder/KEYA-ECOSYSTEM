import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from './client';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
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
