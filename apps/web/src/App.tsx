import { useState } from 'react';

import { AlertBanner } from '@keya/design-system';

import { useApiClient } from './api/ApiClientContext';
import { ApiError } from './api/client';
import { buildRedirectUrl, resolveAppOrigins, resolveRedirectApp } from './auth/redirectTarget';

/**
 * Écran de connexion (ticket 020) — seul point d'entrée d'authentification
 * du frontend. Remplace le mécanisme manuel
 * (`localStorage.setItem('keya_access_token', '<jwt>')`, documenté depuis
 * les tickets 008/009 comme un pis-aller « en attendant ce futur ticket »)
 * par un vrai flux de connexion : formulaire → `POST /api/auth/login/` →
 * `GET /api/me/` → redirection vers l'app correspondant au RÔLE réel de
 * l'utilisateur (voir `auth/redirectTarget.ts`).
 *
 * `redirect` est injectable (test) — `window.location.assign` par défaut,
 * jamais appelé directement pour rester testable sans navigation réelle en
 * environnement jsdom.
 */
export interface AppProps {
  redirect?: (url: string) => void;
}

export function App({ redirect = (url) => { window.location.assign(url); } }: AppProps) {
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { access, refresh } = await api.login(email, password);
      const me = await api.getMe(access);
      const targetApp = resolveRedirectApp(me);
      const origins = resolveAppOrigins();
      redirect(buildRedirectUrl(origins[targetApp], access, refresh));
      // Volontairement PAS de `setSubmitting(false)` ici : une redirection
      // réelle va démonter ce composant, remettre le formulaire actif
      // entre-temps ne ferait que clignoter avant la navigation.
    } catch (caught) {
      // Ticket 020, vérifié empiriquement : identifiants invalides, compte
      // désactivé (`is_active=False`, ticket 011) et email inexistant
      // renvoient TOUS le même 401 générique côté backend (simplejwt,
      // volontairement non distinctif — évite l'énumération de comptes).
      // Aucun message différencié n'existe à afficher ici.
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Identifiants invalides.');
      } else {
        setError('Une erreur est survenue. Réessayez.');
      }
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <form
        onSubmit={(event) => { void handleSubmit(event); }}
        aria-label="Connexion"
        style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '320px' }}
      >
        <h1>KEYA — Connexion</h1>

        {error && <AlertBanner title={error} />}

        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}
