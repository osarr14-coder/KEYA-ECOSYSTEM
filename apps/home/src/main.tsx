import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GlobalStyles } from '@keya/design-system';

import { ApiClientProvider } from './api/ApiClientContext';
import { createApiClient } from './api/client';
import { App } from './App';
import { receiveIncomingSession } from './auth/receiveIncomingSession';

// Ticket 020 : consomme une session transmise par l'écran de connexion
// (`apps/web`) via fragment d'URL, AVANT toute autre chose — le token doit
// déjà être en localStorage quand `createApiClient` ci-dessous le lit.
// Remplace le mécanisme manuel documenté depuis les tickets 008/009
// (`localStorage.setItem('keya_access_token', '<jwt>')` posé à la main),
// qui reste utilisable pour un test manuel direct contre le backend.
receiveIncomingSession();

// Ticket 019 : même mécanisme que le token ci-dessus (localStorage, pas un
// état React seul) — l'organisation active doit survivre à un rechargement,
// exactement comme la session elle-même.
const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  getAccessToken: () => localStorage.getItem('keya_access_token'),
  getActiveOrganizationId: () => localStorage.getItem('keya_active_organization_id'),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStyles />
    <ApiClientProvider client={apiClient}>
      <App />
    </ApiClientProvider>
  </StrictMode>,
);
