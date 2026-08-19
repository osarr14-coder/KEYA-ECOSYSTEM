import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ApiClientProvider } from './api/ApiClientContext';
import { createApiClient } from './api/client';
import { App } from './App';

// Ticket 008 est explicitement en lecture seule et ne couvre aucun écran de
// connexion — aucun ticket de ce backlog n'a encore construit d'UI
// d'authentification frontend (le login existe côté API depuis le ticket
// 001). En attendant ce futur ticket, le token est lu depuis localStorage :
// `localStorage.setItem('keya_access_token', '<jwt>')` pour un test manuel
// réel contre le backend Django.
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
    <ApiClientProvider client={apiClient}>
      <App />
    </ApiClientProvider>
  </StrictMode>,
);
