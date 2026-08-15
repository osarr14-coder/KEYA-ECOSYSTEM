import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ApiClientProvider } from './api/ApiClientContext';
import { createApiClient } from './api/client';
import { App } from './App';

// Comme apps/home (ticket 008) : aucun ticket de ce backlog n'a encore
// construit d'UI de connexion frontend — token lu depuis localStorage en
// attendant un futur ticket d'authentification.
// `localStorage.setItem('keya_access_token', '<jwt>')` pour un test réel.
const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  getAccessToken: () => localStorage.getItem('keya_access_token'),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiClientProvider client={apiClient}>
      <App />
    </ApiClientProvider>
  </StrictMode>,
);
