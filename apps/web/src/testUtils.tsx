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
    // Ticket 027 (apps/procurement) :
    listDevisForLot: vi.fn(notMocked),
    createDevis: vi.fn(notMocked),
    lockDevis: vi.fn(notMocked),
    listAjustements: vi.fn(notMocked),
    createAjustement: vi.fn(notMocked),
    // Ticket B-028 (apps/procurement, recherche) :
    searchLots: vi.fn(notMocked),
    searchOrganizations: vi.fn(notMocked),
    // Ticket F-036 (apps/procurement, recherche — B-037) :
    searchLotsEligibleForLedger: vi.fn(notMocked),
    // Ticket F-028 (apps/pricing) :
    getCurrentPricingRates: vi.fn(notMocked),
    getPricingHistory: vi.fn(notMocked),
    createPricingConfig: vi.fn(notMocked),
    // Ticket F-030 (apps/pricing, LegalPaymentTierTemplate) :
    createLegalPaymentTierTemplate: vi.fn(notMocked),
    activateLegalPaymentTierTemplate: vi.fn(notMocked),
    getActiveLegalPaymentTierTemplate: vi.fn(notMocked),
    getLegalPaymentTierTemplateHistory: vi.fn(notMocked),
    // Ticket B-030 (apps/organizations) :
    listCountryPacks: vi.fn(notMocked),
    // Ticket F-035 (apps/procurement, LotLedger) :
    getLotLedger: vi.fn(notMocked),
    getLotLedgerMargin: vi.fn(notMocked),
    createLotLedger: vi.fn(notMocked),
    // Ticket F-035 bis (apps/procurement, LotBcCharge — B-036) :
    getLotBcCharges: vi.fn(notMocked),
    // Ticket F-049 (apps/programs, B-039) :
    createProgram: vi.fn(notMocked),
    createAsset: vi.fn(notMocked),
    createLot: vi.fn(notMocked),
    // Ticket F-058 (apps/programs, B-042) :
    listProgramRequests: vi.fn(notMocked),
    decideProgramRequest: vi.fn(notMocked),
    ...overrides,
  };
}

export function withApiClient(client: ApiClient, children: ReactNode) {
  return <ApiClientProvider client={client}>{children}</ApiClientProvider>;
}
