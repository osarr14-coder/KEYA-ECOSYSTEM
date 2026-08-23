import { type FormEvent, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Card, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { ProgramRequest } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-057 — écran frontend de `ProgramRequest` (ticket B-042,
 * backend) : un prospect « sponsor » (bien sur mesure, jamais un lot
 * existant — voir `apps/home/src/App.tsx` pour la distinction avec le
 * reste de cette app) soumet une demande, puis suit son statut. Ne crée
 * JAMAIS de `Program` : `admin_keyimmo` instruit la demande (accepte/
 * refuse) séparément, via le wizard existant (F-049) — cet écran reste
 * strictement lecture + soumission, jamais une création de programme.
 *
 * `status` (`en_attente`/`acceptee`/`refusee`) n'est PAS un `TrustLevel`
 * — jamais `StatusBadge` ici, même raisonnement déjà appliqué à
 * `SyncStatusIndicator`/`MissionTypeIndicator` (CONTROL PWA) : un texte
 * simple suffit, aucun second consommateur ne réclame un badge partagé
 * pour ce vocabulaire précis.
 *
 * Ticket F-059 — bandeau de notification : `admin_keyimmo` accepte/refuse
 * une demande via `apps/web` (ticket F-058), qui crée une `Task`
 * `type=notification` assignée au prospect (`apps.tasks.services.
 * create_task_for_program_request_decided`, ticket B-043). Réutilise
 * `getMyTasks` (déjà consommé par `MyActionsView`/`PriorityTaskSummary`,
 * ticket 008) — AUCUN nouvel endpoint. Affiché ICI en plus de l'onglet
 * « Mes actions » (accessible seulement une fois qu'un bien existe,
 * `App.tsx`) : cet écran est le seul point d'atterrissage GARANTI d'un
 * prospect sans bien (son état normal juste après la décision — refusée
 * pour toujours, ou acceptée mais en attente que `admin_keyimmo` crée
 * effectivement son programme). Purement informatif, jamais de bouton
 * « marquer comme lu » — `MyActionsView` (HOME) n'en a jamais eu non plus,
 * aucune régression introduite ici.
 */
const STATUS_LABELS: Record<ProgramRequest['status'], string> = {
  en_attente: 'En attente',
  acceptee: 'Acceptée',
  refusee: 'Refusée',
};

function RequestStatusLabel({ status }: { status: ProgramRequest['status'] }) {
  const color = status === 'acceptee' ? semanticColors.progress.fill : semanticColors.neutral.textMuted;
  return (
    <strong data-testid="request-status" data-status={status} style={{ color }}>
      {STATUS_LABELS[status]}
    </strong>
  );
}

function CreateProgramRequestForm({ onCreated }: { onCreated: () => void }) {
  const api = useApiClient();
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createProgramRequest(description);
      setDescription('');
      onCreated();
    } catch {
      setError("Échec de l'envoi de la demande.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Décrire mon projet" icon="building">
      <form onSubmit={(event) => { void handleSubmit(event); }} aria-label="Soumettre une demande de programme">
        <label>
          Type de bien souhaité, localisation, budget indicatif…
          {/* Ticket F-057 — pas de composant `Textarea` partagé dans le
              design system aujourd'hui (seul `Input`, `<input>` mono-ligne,
              existe) : styles inline reprenant les mêmes tokens que
              `Input.tsx` (bordure/rayon/couleur), plutôt qu'inventer une
              nouvelle valeur — un futur ticket pourra promouvoir ceci en
              composant partagé si un second consommateur le réclame. */}
          <textarea
            aria-label="Type de bien souhaité, localisation, budget indicatif…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
            rows={4}
            style={{
              display: 'block',
              width: '100%',
              marginTop: '4px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: `1px solid ${semanticColors.neutral.border}`,
              fontSize: '14px',
              fontFamily: 'inherit',
              color: semanticColors.neutral.text,
              background: semanticColors.neutral.surface,
              resize: 'vertical',
            }}
          />
        </label>
        <Button type="submit" disabled={submitting || !description.trim()} style={{ marginTop: '8px' }}>
          {submitting ? 'Envoi…' : 'Envoyer ma demande'}
        </Button>
        {error && <div style={{ marginTop: '8px' }}><AlertBanner title={error} /></div>}
      </form>
    </Card>
  );
}

function ProgramRequestNotifications() {
  const api = useApiClient();
  const state = useApiResource(
    () => api.getMyTasks({ type: 'notification', status: 'pending' }), [],
  );

  if (state.status !== 'success' || state.data.length === 0) return null;

  return (
    <Card title="Notifications" icon="bell">
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {state.data.map((task) => (
          <li
            key={task.id}
            style={{
              padding: '12px',
              border: `1px solid ${semanticColors.neutral.border}`,
              borderRadius: '14px',
              boxShadow: 'var(--keya-shadow-sm)',
            }}
          >
            {task.label}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProgramRequestView() {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyProgramRequests(), []);

  return (
    <section aria-label="Programme sur mesure" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <ProgramRequestNotifications />
      <CreateProgramRequestForm onCreated={() => state.refetch()} />

      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger vos demandes." onRetry={state.refetch} />
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <Card title="Mes demandes" icon="clipboard-check">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {state.data.map((request) => (
              <li
                key={request.id}
                style={{
                  padding: '12px',
                  border: `1px solid ${semanticColors.neutral.border}`,
                  borderRadius: '14px',
                  boxShadow: 'var(--keya-shadow-sm)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <RequestStatusLabel status={request.status} />
                  <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>
                    {new Date(request.created_at).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                <p style={{ margin: '8px 0 0' }}>{request.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
