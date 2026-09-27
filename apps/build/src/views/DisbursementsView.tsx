import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { ReceivedDisbursement } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-068 — paiements reçus par l'organisation active (backend B-052,
 * CDC V3 §8.2/§8.3) : sorties SIMULÉES du compte d'un programme, exécutées
 * par Finance après acceptation technique du jalon. Le constructeur peut
 * confirmer la réception : une information, jamais une preuve bancaire —
 * le rapprochement reste une décision Finance.
 */

const SIMULATION_NOTICE = 'SIMULÉ — AUCUN FONDS RÉEL · DÉMONSTRATION — DONNÉES FICTIVES';

function formatAmount(value: string, currency: string) {
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`;
}

function DisbursementCard({
  disbursement, onConfirmed,
}: { disbursement: ReceivedDisbursement; onConfirmed: () => void }) {
  const api = useApiClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      await api.confirmDisbursement(disbursement.id);
      onConfirmed();
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Échec de la confirmation.');
      setConfirming(false);
    }
  }

  return (
    <li
      aria-label={`Paiement ${disbursement.lot.name} — ${disbursement.milestone.label}`}
      style={{
        padding: '12px',
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '14px',
        boxShadow: 'var(--keya-shadow-sm)',
      }}
    >
      <strong>{`${disbursement.program.name} — ${disbursement.lot.name} — ${disbursement.milestone.label}`}</strong>
      <p style={{ margin: '4px 0 0' }}>
        {`${formatAmount(disbursement.amount, disbursement.currency)} · référence ${disbursement.bank_reference ?? '—'} du ${disbursement.executed_on ?? '—'}`}
      </p>
      <p style={{ margin: '4px 0 0' }} data-testid="disbursement-flow">{disbursement.flow_status_label}</p>
      {disbursement.beneficiary_confirmation === 'confirmed' ? (
        <p style={{ margin: '4px 0 0' }}>Réception confirmée.</p>
      ) : (
        <div style={{ marginTop: '8px' }}>
          <Button type="button" onClick={() => { void handleConfirm(); }} disabled={confirming}>
            {confirming ? 'Confirmation…' : 'Confirmer la réception'}
          </Button>
        </div>
      )}
      {error && <div style={{ marginTop: '8px' }}><AlertBanner title={error} /></div>}
    </li>
  );
}

export function DisbursementsView() {
  const api = useApiClient();
  const state = useApiResource(() => api.listReceivedDisbursements(), []);

  return (
    <section aria-label="Paiements reçus">
      <h2>Paiements reçus</h2>
      <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em' }}>{SIMULATION_NOTICE}</p>

      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger vos paiements." onRetry={state.refetch} />
      )}
      {state.status === 'success' && state.data.length === 0 && (
        <p data-testid="no-disbursements">Aucun paiement reçu pour le moment.</p>
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {state.data.map((disbursement) => (
            <DisbursementCard key={disbursement.id} disbursement={disbursement} onConfirmed={state.refetch} />
          ))}
        </ul>
      )}
    </section>
  );
}
