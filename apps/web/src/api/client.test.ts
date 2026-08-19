import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createApiClient — login', () => {
  it('POST /api/auth/login/ avec email/mot de passe, renvoie access + refresh', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('http://api.test/api/auth/login/');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@example.com', password: 'secret' });
      return jsonResponse(200, { access: 'access-token', refresh: 'refresh-token' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient({ baseUrl: 'http://api.test' });
    const result = await client.login('a@example.com', 'secret');

    expect(result).toEqual({ access: 'access-token', refresh: 'refresh-token' });
  });

  it(
    'un 401 (identifiants invalides, compte désactivé, ou email inexistant — le backend ne '
    + 'les distingue jamais, vérifié empiriquement) lève une ApiError avec status=401',
    async () => {
      const fetchMock = vi.fn(async () => jsonResponse(401, {
        detail: 'No active account found with the given credentials',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const client = createApiClient({ baseUrl: 'http://api.test' });

      await expect(client.login('a@example.com', 'wrong')).rejects.toMatchObject(
        { status: 401 } satisfies Partial<ApiError>,
      );
    },
  );
});

describe('createApiClient — getMe', () => {
  it('GET /api/me/ avec le token reçu en argument, jamais localStorage', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('http://api.test/api/me/');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer just-obtained-token');
      return jsonResponse(200, {
        id: 'user-1', email: 'a@example.com', full_name: 'A',
        memberships: [
          { organization_id: 'org-1', organization_name: 'Org', role_code: 'constructeur', role_label: 'Constructeur' },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient({ baseUrl: 'http://api.test' });
    const me = await client.getMe('just-obtained-token');

    expect(me.memberships[0].role_code).toBe('constructeur');
  });
});
