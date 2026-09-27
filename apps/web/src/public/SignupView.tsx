import { type FormEvent, useState } from 'react';

import {
  AlertBanner, Button, Field, Input, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import { signInAndRedirect } from '../auth/signInAndRedirect';
import type { PublicPath } from './usePublicPath';

/**
 * Ticket F-079 — inscription d'un acquéreur depuis la page publique (rôle
 * `client`, libre-service côté serveur, débit limité — B-047), puis
 * connexion immédiate et redirection vers son espace (HOME), où il réserve
 * un lot. Les refus du serveur (email déjà utilisé, mot de passe trop
 * court) sont affichés tels quels.
 */
export function SignupView({
  redirect, navigate,
}: { redirect: (url: string) => void; navigate: (path: PublicPath) => void }) {
  const api = useApiClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.registerClient({ email: email.trim(), password, full_name: fullName.trim() });
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, 'L’inscription a échoué. Réessayez.'));
      setSubmitting(false);
      return;
    }
    try {
      await signInAndRedirect(api, email.trim(), password, redirect);
    } catch {
      // Compte créé mais connexion impossible (réseau) : jamais une impasse.
      setError('Votre compte est créé. Connectez-vous pour accéder à votre espace.');
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'clamp(32px, 6vw, 72px) 16px' }}>
      <form
        onSubmit={(event) => { void handleSubmit(event); }}
        aria-label="Créer mon espace acquéreur"
        style={{
          width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '16px', padding: '32px',
          borderRadius: '24px', background: semanticColors.neutral.surface, border: `1px solid ${semanticColors.neutral.border}`,
          boxShadow: 'var(--keya-shadow-md)',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: semanticColors.accent.text }}>
          Espace acquéreur
        </span>
        <h1 style={{ margin: 0, fontSize: '30px' }}>Créer mon espace</h1>
        <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>
          Réservez un lot, suivez vos paiements et l’avancement de votre chantier.
        </p>
        {error && <AlertBanner title={error} />}
        <Field label="Nom complet">
          <Input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Mot de passe (8 caractères minimum)">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="accent" disabled={submitting}>
          {submitting ? 'Création…' : 'Créer mon espace'}
        </Button>
        <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
          Déjà un compte ?{' '}
          <a
            href="/connexion"
            onClick={(event) => { event.preventDefault(); navigate('/connexion'); }}
            style={{ fontWeight: 700, color: semanticColors.neutral.heading }}
          >
            Se connecter
          </a>
        </p>
      </form>
    </div>
  );
}
