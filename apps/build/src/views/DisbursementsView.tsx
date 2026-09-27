import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, BRAND_GRADIENT, Button, PageHeader, Pill, semanticColors, typography,
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
 *
 * Ticket F-076 — un paiement à confirmer est mis en avant (carte navy,
 * montant en grand, bouton or) ; les paiements confirmés restent listés.
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

  const confirmed = disbursement.beneficiary_confirmation === 'confirmed';
  return (
    <li
      aria-label={`Paiement ${disbursement.lot.name} — ${disbursement.milestone.label}`}
      style={{
        listStyle: 'none',
        padding: '22px 24px',
        borderRadius: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        ...(confirmed
          ? { background: semanticColors.neutral.surface, border: `1px solid ${semanticColors.neutral.border}` }
          : { background: BRAND_GRADIENT, color: '#FFFFFF' }),
      }}
    >
      <span
        style={{
          fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: confirmed ? semanticColors.accent.text : '#E2C47A',
        }}
      >
        {`Paiement reçu · simulé · ${disbursement.milestone.label}`}
      </span>
      <span style={{ fontFamily: typography.headingFontFamily, fontSize: '32px', fontWeight: 600, color: confirmed ? semanticColors.neutral.heading : '#FFFFFF' }}>
        {formatAmount(disbursement.amount, disbursement.currency)}
      </span>
      <strong>{`${disbursement.program.name} — ${disbursement.lot.name} — ${disbursement.milestone.label}`}</strong>
      <p style={{ margin: 0, color: confirmed ? semanticColors.neutral.textMuted : '#D5DCE8' }}>
        {`${formatAmount(disbursement.amount, disbursement.currency)} · référence ${disbursement.bank_reference ?? '—'} du ${disbursement.executed_on ?? '—'}`}
      </p>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <Pill tone={confirmed ? 'success' : 'accent'} data-testid="disbursement-flow">{disbursement.flow_status_label}</Pill>
        {confirmed && <span>Réception confirmée.</span>}
      </div>
      {!confirmed && (
        <div>
          <Button type="button" variant="accent" onClick={() => { void handleConfirm(); }} disabled={confirming}>
            {confirming ? 'Confirmation…' : 'Confirmer la réception'}
          </Button>
        </div>
      )}
      {error && <AlertBanner title={error} />}
    </li>
  );
}

export function DisbursementsView() {
  const api = useApiClient();
  const state = useApiResource(() => api.listReceivedDisbursements(), []);

  return (
    <section aria-label="Paiements reçus">
      <PageHeader
        eyebrow="Finance du chantier"
        title="Paiements reçus"
        subtitle="Versés par KEYIMMO après acceptation technique de chaque jalon. Confirmez leur réception."
      />
      <p style={{ margin: '0 0 16px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', color: semanticColors.accent.text }}>
        {SIMULATION_NOTICE}
      </p>

      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger vos paiements." onRetry={state.refetch} />
      )}
      {state.status === 'success' && state.data.length === 0 && (
        <p data-testid="no-disbursements">Aucun paiement reçu pour le moment.</p>
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <ul
          style={{
            listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px',
          }}
        >
          {state.data.map((disbursement) => (
            <DisbursementCard key={disbursement.id} disbursement={disbursement} onConfirmed={state.refetch} />
          ))}
        </ul>
      )}
    </section>
  );
}
