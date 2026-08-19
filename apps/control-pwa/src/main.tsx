import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { receiveIncomingSession } from './auth/receiveIncomingSession';

// Ticket 020 : consomme une session transmise par l'écran de connexion
// (`apps/web`) via fragment d'URL, AVANT toute autre chose — le token doit
// déjà être en localStorage quand `createDefaultApiClient` (App.tsx) le lit.
// Remplace le mécanisme manuel documenté depuis le ticket 010
// (`localStorage.setItem('keya_access_token', '<jwt>')` posé à la main),
// qui reste utilisable pour un test manuel direct contre le backend.
receiveIncomingSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
