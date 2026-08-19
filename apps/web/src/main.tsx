import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ApiClientProvider } from './api/ApiClientContext';
import { createApiClient } from './api/client';
import { App } from './App';

const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiClientProvider client={apiClient}>
      <App />
    </ApiClientProvider>
  </StrictMode>,
);
