import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DemoBanner, GlobalStyles, consumeLogoutRequest } from '@keya/design-system';

import { ApiClientProvider } from './api/ApiClientContext';
import { createApiClient } from './api/client';
import { App } from './App';
import { forceLogout } from './auth/forceLogout';
import { receiveIncomingSession } from './auth/receiveIncomingSession';

// Ticket 021 : apps/web peut désormais être elle-même la destination d'une
// redirection (`admin_keyimmo` → 'web', back-office) — consomme un
// éventuel fragment AVANT tout le reste, même mécanisme que
// `apps/{home,build,control-pwa}` depuis le ticket 020. Sans fragment
// (chargement normal de l'écran de connexion), ne fait rien.
// Ticket F-070 — `?logout=1` (déconnexion demandée depuis n'importe quelle
// app) : efface d'abord la session de cette origine.
consumeLogoutRequest();
receiveIncomingSession();

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

const apiClient = createApiClient({
  baseUrl: API_BASE_URL,
  getAccessToken: () => localStorage.getItem('keya_access_token'),
  onUnauthorized: forceLogout,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStyles />
    {/* Audit UI R1 (M01/M02) : marquage démo permanent sur tous les écrans. */}
    <DemoBanner apiBaseUrl={API_BASE_URL} />
    <ApiClientProvider client={apiClient}>
      <App />
    </ApiClientProvider>
  </StrictMode>,
);
