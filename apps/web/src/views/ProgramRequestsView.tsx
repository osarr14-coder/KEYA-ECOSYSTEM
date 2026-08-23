import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Card, Select, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { ProgramRequest } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-058 — pendant admin de `ProgramRequestView.tsx` (apps/home,
 * ticket F-057) : `admin_keyimmo` instruit les demandes de programme sur
 * mesure (accepte/refuse). Ne crée JAMAIS de `Program` — verrou KEYIMMO
 * gatekeeper (ticket B-039) intact : une fois une demande acceptée,
 * l'admin la crée séparément via l'onglet « Programmes » existant
 * (`ProgramsView.tsx`), en désignant l'organisation du demandeur (déjà
 * affichée sur chaque carte) comme organisation cible.
 *
 * `status` n'est PAS un `TrustLevel` — même distinction que
 * `Devis.status` (ticket 022), jamais `StatusBadge` ici, un texte simple
 * suffit (même raisonnement que `ProgramRequestView.tsx`, apps/home).
 */
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'en_attente', label: 'En attente' },
  { value: 'acceptee', label: 'Acceptées' },
  { value: 'refusee', label: 'Refusées' },
  { value: '', label: 'Toutes' },
];

const STATUS_LABELS: Record<ProgramRequest['status'], string> = {
  en_attente: 'En attente',
  acceptee: 'Acceptée',
  refusee: 'Refusée',
};

function RequestCard({ request, onDecided }: { request: ProgramRequest; onDecided: () => void }) {
  const api = useApiClient();
  const [deciding, setDeciding] = useState<'acceptee' | 'refusee' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDecide(status: 'acceptee' | 'refusee') {
    setDeciding(status);
    setError(null);
    try {
      await api.decideProgramRequest(request.id, request.organization, status);
      onDecided();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.detail : undefined;
      setError(detail ?? "Échec de la décision.");
    } finally {
      setDeciding(null);
    }
  }

  const color = request.status === 'acceptee' ? semanticColors.progress.fill : semanticColors.neutral.textMuted;

  return (
    <li
      style={{
        padding: '12px',
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '14px',
        boxShadow: 'var(--keya-shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <strong>{request.organization_name}</strong>
        <span data-testid="request-status" data-status={request.status} style={{ color, fontWeight: 600 }}>
          {STATUS_LABELS[request.status]}
        </span>
      </div>
      <p data-testid="request-meta" style={{ margin: '4px 0', fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        {request.requested_by_email} — {new Date(request.created_at).toLocaleDateString('fr-FR')}
      </p>
      <p style={{ margin: '8px 0' }}>{request.description}</p>

      {request.status === 'en_attente' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <Button
            type="button"
            onClick={() => { void handleDecide('acceptee'); }}
            disabled={deciding !== null}
          >
            {deciding === 'acceptee' ? 'Acceptation…' : 'Accepter'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => { void handleDecide('refusee'); }}
            disabled={deciding !== null}
          >
            {deciding === 'refusee' ? 'Refus…' : 'Refuser'}
          </Button>
        </div>
      )}
      {request.status === 'acceptee' && !request.program && (
        <p style={{ margin: '8px 0 0', fontSize: '13px', color: semanticColors.neutral.textMuted }}>
          Demande acceptée — créez le programme depuis l&apos;onglet « Programmes »,
          en désignant {request.organization_name} comme organisation cible.
        </p>
      )}
      {error && <div style={{ marginTop: '8px' }}><AlertBanner title={error} /></div>}
    </li>
  );
}

export function ProgramRequestsView() {
  const api = useApiClient();
  const [statusFilter, setStatusFilter] = useState('en_attente');
  const state = useApiResource(() => api.listProgramRequests(statusFilter || undefined), [statusFilter]);

  return (
    <section aria-label="Demandes de programme" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2>Demandes de programme</h2>

      <Card icon="clipboard-check">
        <label>
          Statut
          <Select
            aria-label="Filtrer par statut"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            style={{ marginTop: '4px', width: 'auto' }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </label>
      </Card>

      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger les demandes." onRetry={state.refetch} />
      )}
      {state.status === 'success' && state.data.length === 0 && (
        <p data-testid="no-requests">Aucune demande pour ce filtre.</p>
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {state.data.map((request) => (
            <RequestCard key={request.id} request={request} onDecided={() => state.refetch()} />
          ))}
        </ul>
      )}
    </section>
  );
}
