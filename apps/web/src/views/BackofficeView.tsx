import { type FormEvent, useState } from 'react';

import { AlertBanner, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { useApiResource } from '../api/useApiResource';
import type { BackofficeUserSummary } from '../api/types';

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; results: BackofficeUserSummary[] };

/**
 * Ticket 021, point 3 du scope — désactivation avec confirmation EXPLICITE :
 * un premier clic sur « Désactiver ce compte » n'exécute RIEN, il « arme »
 * seulement un second écran de confirmation (`AlertBanner` + un second
 * bouton dédié) — seul CE second clic appelle `api.deactivateUser`. Jamais
 * un `window.confirm()` navigateur (pas testable proprement, pas cohérent
 * avec le design system) ni une action déclenchée en un seul clic : c'est
 * une action destructive pour l'ACCÈS d'un compte (irréversible tant qu'un
 * autre admin ne réactive pas le compte manuellement, hors scope de ce
 * ticket comme du ticket 011 backend).
 *
 * Point 4 du scope — AUCUN texte ici ne mentionne un `TrustEvent`, une
 * réserve, une validation ou un statut de confiance : cette action ne porte
 * QUE sur l'accès du compte (`User.is_active`), jamais sur une décision
 * métier. Vérifié par un test qui scanne tous les boutons rendus contre une
 * liste de formulations interdites (`BackofficeView.test.tsx`), même
 * pattern que `apps/build/src/views/ExceptionsView.test.tsx` (ticket 009).
 */
function UserDetailPanel({ userId }: { userId: string }) {
  const api = useApiClient();
  const [reloadKey, setReloadKey] = useState(0);
  const state = useApiResource(() => api.getUserDetail(userId), [userId, reloadKey]);
  const [confirming, setConfirming] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  async function handleConfirmDeactivate() {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await api.deactivateUser(userId);
      setConfirming(false);
      // Relit l'état RÉEL depuis le backend plutôt qu'une mise à jour
      // optimiste locale — aucun calcul frontend, même discipline que le
      // reste du projet (CLAUDE.md, doctrine Visible Trust).
      setReloadKey((key) => key + 1);
    } catch {
      setDeactivateError('Échec de la désactivation.');
    } finally {
      setDeactivating(false);
    }
  }

  if (state.status === 'loading') {
    return <p>Chargement du profil…</p>;
  }
  if (state.status === 'error') {
    return <AlertBanner title="Impossible de charger ce profil." />;
  }

  const { user, memberships } = state.data;

  return (
    <section
      aria-label={`Profil de ${user.email}`}
      style={{
        marginTop: '16px',
        padding: '16px',
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '8px',
      }}
    >
      <h3 style={{ marginTop: 0 }}>{user.email}</h3>
      <p>{user.full_name}</p>
      <p data-testid="account-status">{user.is_active ? 'Compte actif' : 'Compte désactivé'}</p>

      <h4>Organisation(s) et rôle(s)</h4>
      {memberships.length === 0 ? (
        <p>Aucune organisation.</p>
      ) : (
        <ul style={{ paddingLeft: '20px' }}>
          {memberships.map((membership) => (
            <li key={membership.organization_id}>
              {membership.organization_name} — {membership.role}
            </li>
          ))}
        </ul>
      )}

      {user.is_active && (
        confirming ? (
          <div aria-label="Confirmation de désactivation" style={{ marginTop: '12px' }}>
            <AlertBanner title="Confirmer la désactivation du compte">
              Cette action bloque immédiatement l&apos;accès de {user.email} à la plateforme.
              Aucune donnée n&apos;est supprimée — l&apos;historique de cet utilisateur reste intact.
            </AlertBanner>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button type="button" onClick={() => { void handleConfirmDeactivate(); }} disabled={deactivating}>
                {deactivating ? 'Désactivation…' : 'Confirmer la désactivation'}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={deactivating}>
                Annuler
              </button>
            </div>
            {deactivateError && (
              <div style={{ marginTop: '8px' }}>
                <AlertBanner title={deactivateError} />
              </div>
            )}
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} style={{ marginTop: '12px' }}>
            Désactiver ce compte
          </button>
        )
      )}
    </section>
  );
}

export function BackofficeView() {
  const api = useApiClient();
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setSearchState({ status: 'loading' });
    setSelectedUserId(null);
    try {
      const results = await api.searchUsers(query);
      setSearchState({ status: 'success', results });
    } catch {
      setSearchState({ status: 'error' });
    }
  }

  return (
    <section aria-label="Back-office">
      <h2>Recherche d&apos;utilisateur</h2>
      <form
        onSubmit={(event) => { void handleSearch(event); }}
        role="search"
        style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <label>
          Rechercher un utilisateur par email
          <input
            type="search"
            aria-label="Rechercher un utilisateur par email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ display: 'block', marginTop: '4px' }}
          />
        </label>
        <button type="submit">Rechercher</button>
      </form>

      {searchState.status === 'loading' && <p>Recherche…</p>}
      {searchState.status === 'error' && <AlertBanner title="Impossible d'effectuer la recherche." />}
      {searchState.status === 'success' && (
        searchState.results.length === 0 ? (
          <p data-testid="no-results">Aucun utilisateur trouvé.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {searchState.results.map((user) => (
              <li key={user.id}>
                <button type="button" onClick={() => setSelectedUserId(user.id)} style={{ width: '100%', textAlign: 'left' }}>
                  {user.email} — {user.full_name}
                  {!user.is_active && ' (compte désactivé)'}
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {selectedUserId && <UserDetailPanel key={selectedUserId} userId={selectedUserId} />}
    </section>
  );
}
