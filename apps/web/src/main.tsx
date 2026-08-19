import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GlobalStyles } from '@keya/design-system';

import { ApiClientProvider } from './api/ApiClientContext';
import { createApiClient } from './api/client';
import { App } from './App';
import { receiveIncomingSession } from './auth/receiveIncomingSession';

// Ticket 021 : apps/web peut désormais être elle-même la destination d'une
// redirection (`admin_keyimmo` → 'web', back-office) — consomme un
// éventuel fragment AVANT tout le reste, même mécanisme que
// `apps/{home,build,control-pwa}` depuis le ticket 020. Sans fragment
// (chargement normal de l'écran de connexion), ne fait rien.
receiveIncomingSession();

const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  getAccessToken: () => localStorage.getItem('keya_access_token'),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStyles />
    <ApiClientProvider client={apiClient}>
      <App />
    </ApiClientProvider>
  </StrictMode>,
);
