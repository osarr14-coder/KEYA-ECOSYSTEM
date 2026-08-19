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
  it('avec un token explicite (ticket 020, formulaire de connexion), jamais localStorage', async () => {
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

  it(
    'sans argument (ticket 021, back-office déjà connecté), lit le token via getAccessToken',
    async () => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer stored-token');
        return jsonResponse(200, { id: 'user-1', email: 'a@example.com', full_name: 'A', memberships: [] });
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'stored-token' });
      await client.getMe();

      expect(fetchMock).toHaveBeenCalled();
    },
  );
});

describe('createApiClient — back-office (ticket 011/021)', () => {
  it('searchUsers : GET /api/backoffice/users/?q=... avec le token stocké', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('http://api.test/api/backoffice/users/?q=alice');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer admin-token');
      return jsonResponse(200, [
        { id: 'user-1', email: 'alice@example.com', full_name: 'Alice', is_active: true },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'admin-token' });
    const results = await client.searchUsers('alice');

    expect(results).toEqual([{ id: 'user-1', email: 'alice@example.com', full_name: 'Alice', is_active: true }]);
  });

  it('searchUsers : une recherche vide n\'ajoute aucun paramètre `q` (le backend décide seul du comportement)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toBe('http://api.test/api/backoffice/users/');
      return jsonResponse(200, []);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'admin-token' });
    await client.searchUsers('');
  });

  it('getUserDetail : GET /api/backoffice/users/{id}/', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toBe('http://api.test/api/backoffice/users/user-1/');
      return jsonResponse(200, {
        user: { id: 'user-1', email: 'alice@example.com', full_name: 'Alice', is_active: true },
        memberships: [{ organization_id: 'org-1', organization_name: 'Org', role: 'constructeur' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'admin-token' });
    const detail = await client.getUserDetail('user-1');

    expect(detail.memberships[0].role).toBe('constructeur');
  });

  it('deactivateUser : POST /api/backoffice/users/{id}/deactivate/, jamais GET', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('http://api.test/api/backoffice/users/user-1/deactivate/');
      expect(init?.method).toBe('POST');
      return jsonResponse(200, { id: 'user-1', email: 'alice@example.com', full_name: 'Alice', is_active: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'admin-token' });
    const result = await client.deactivateUser('user-1');

    expect(result.is_active).toBe(false);
  });

  it('un 403 (rôle admin_keyimmo absent) lève une ApiError, jamais silencieusement ignoré', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(403, { detail: 'Réservé aux membres du rôle admin_keyimmo.' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'not-admin-token' });

    await expect(client.searchUsers('alice')).rejects.toMatchObject({ status: 403 } satisfies Partial<ApiError>);
  });
});
