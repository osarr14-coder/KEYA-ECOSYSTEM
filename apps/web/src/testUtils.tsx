import type { ReactNode } from 'react';
import { vi } from 'vitest';

import type { ApiClient } from './api/client';
import { ApiClientProvider } from './api/ApiClientContext';

/** Un `ApiClient` entièrement mocké — chaque méthode rejette par défaut
 * (`Error('not mocked')`) pour qu'un test qui oublie de fournir une réponse
 * échoue bruyamment plutôt que de rendre un état de chargement infini. */
export function createMockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notMocked = () => Promise.reject(new Error('not mocked'));
  return {
    login: vi.fn(notMocked),
    getMe: vi.fn(notMocked),
    searchUsers: vi.fn(notMocked),
    getUserDetail: vi.fn(notMocked),
    deactivateUser: vi.fn(notMocked),
    ...overrides,
  };
}

export function withApiClient(client: ApiClient, children: ReactNode) {
  return <ApiClientProvider client={client}>{children}</ApiClientProvider>;
}
