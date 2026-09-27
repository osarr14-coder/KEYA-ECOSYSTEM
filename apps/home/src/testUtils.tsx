import type { ReactNode } from 'react';
import { vi } from 'vitest';

import type { ApiClient } from './api/client';
import { ApiClientProvider } from './api/ApiClientContext';

/** Un `ApiClient` entièrement mocké — chaque méthode rejette par défaut
 * (`Error('not mocked')`) pour qu'un test qui oublie de fournir une réponse
 * échoue bruyamment plutôt que de rendre un état de chargement infini.
 */
export function createMockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notMocked = () => Promise.reject(new Error('not mocked'));
  return {
    getMe: vi.fn(notMocked),
    getMyLots: vi.fn(notMocked),
    getLotOverview: vi.fn(notMocked),
    getLotEvidenceFeed: vi.fn(notMocked),
    getMyTasks: vi.fn(notMocked),
    getMyProgramRequests: vi.fn(notMocked),
    createProgramRequest: vi.fn(notMocked),
    completeTask: vi.fn(notMocked),
    // Ticket F-066 (catalogue et réservations, B-048) :
    getCatalogLots: vi.fn(notMocked),
    getMyReservations: vi.fn(notMocked),
    requestReservation: vi.fn(notMocked),
    cancelMyReservation: vi.fn(notMocked),
    // Ticket F-066 partie 2 (contrat, B-049) :
    getMyContracts: vi.fn(notMocked),
    signContract: vi.fn(notMocked),
    // Ticket F-068 (appels de fonds, B-050/B-051) :
    getMyPaymentCalls: vi.fn(notMocked),
    // Ticket F-071 (déclaration de virement, B-056) :
    declarePayment: vi.fn(notMocked),
    ...overrides,
  };
}

export function withApiClient(client: ApiClient, children: ReactNode) {
  return <ApiClientProvider client={client}>{children}</ApiClientProvider>;
}
