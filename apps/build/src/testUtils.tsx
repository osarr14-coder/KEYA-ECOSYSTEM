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
    getMe: vi.fn(notMocked),
    getExceptions: vi.fn(notMocked),
    getAllLots: vi.fn(notMocked),
    assignLotOrganization: vi.fn(notMocked),
    createReserveCorrection: vi.fn(notMocked),
    addEvidenceDocument: vi.fn(notMocked),
    // Ticket F-060 (compteur cloche AppShell) :
    getMyTasks: vi.fn(notMocked),
    // Ticket F-062 (marquer une tâche traitée) :
    completeTask: vi.fn(notMocked),
    ...overrides,
  };
}

export function withApiClient(client: ApiClient, children: ReactNode) {
  return <ApiClientProvider client={client}>{children}</ApiClientProvider>;
}
