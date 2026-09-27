import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Input, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { ClientPaymentCall } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-068 — appels de fonds du client (backend B-050/B-051, CDC V3
 * §8.1) : montant appelé et état de couverture, tels que calculés par le
 * serveur.
 *
 * Ticket F-071 (backend B-056) — le client PAIE : instructions de virement
 * (compte FICTIF, référence propre à l'appel) puis « J'ai effectué le
 * virement ». Sa déclaration n'est pas une preuve : l'appel n'est « couvert »
 * qu'une fois le virement confirmé par Finance (KEYIMMO).
 */

const SETTLEMENT_LABELS: Record<NonNullable<ClientPaymentCall['settlement']>, string> = {
  to_pay: 'À payer',
  partial: 'Partiellement couvert',
  settled: 'Couvert',
};

function formatAmount(value: string | null, currency: string) {
  if (value === null) return '—';
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function errorDetail(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && caught.body && typeof caught.body === 'object' && 'detail' in caught.body) {
    return String((caught.body as { detail: unknown }).detail);
  }
  return fallback;
}

function DeclareForm({ call, onDeclared }: { call: ClientPaymentCall; onDeclared: () => void }) {
  const api = useApiClient();
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.declarePayment(call.id, { client_reference: reference.trim(), paid_on: paidOn });
      onDeclared();
    } catch (caught) {
      setError(errorDetail(caught, 'La déclaration a échoué. Réessayez.'));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label={`Déclarer mon virement — ${call.kind_label}`}
      style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '8px' }}
    >
      <label>
        Référence de mon virement
        <Input
          aria-label="Référence de mon virement"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          required
          style={{ marginTop: '4px', width: '220px' }}
        />
      </label>
      <label>
        Date du virement
        <Input
          aria-label="Date du virement"
          type="date"
          value={paidOn}
          onChange={(event) => setPaidOn(event.target.value)}
          required
          style={{ marginTop: '4px' }}
        />
      </label>
      <Button type="submit" disabled={submitting || reference.trim() === ''}>
        {submitting ? 'Envoi…' : "J'ai effectué le virement"}
      </Button>
      {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function CallRow({ call, onChanged }: { call: ClientPaymentCall; onChanged: () => void }) {
  const notice = call.notice ?? null;
  const settled = call.settlement === 'settled';
  const awaitingConfirmation = notice?.status === 'declared';
  const canDeclare = !settled && !awaitingConfirmation;

  return (
    <li
      data-testid="payment-call"
      style={{
        listStyle: 'none', padding: '12px', marginTop: '8px',
        border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '12px',
      }}
    >
      <strong>{call.tier_label ? `${call.kind_label} — ${call.tier_label}` : call.kind_label}</strong>
      {` : ${formatAmount(call.amount, call.currency)} · `}
      <span data-testid="payment-call-settlement">{call.settlement ? SETTLEMENT_LABELS[call.settlement] : '—'}</span>
      {call.settlement === 'partial' && ` (${formatAmount(call.settled_amount, call.currency)} reçus)`}

      {awaitingConfirmation && notice && (
        <p style={{ margin: '6px 0 0' }} data-testid="payment-notice">
          {`Virement déclaré le ${notice.paid_on} (réf. ${notice.client_reference}) — en attente de confirmation par KEYIMMO.`}
        </p>
      )}
      {notice?.status === 'rejected' && !settled && (
        <p role="status" style={{ margin: '6px 0 0' }} data-testid="payment-notice">
          {`Virement non reçu par KEYIMMO : ${notice.rejection_reason}. Vérifiez votre virement puis déclarez-le à nouveau.`}
        </p>
      )}

      {canDeclare && call.payment_instructions && (
        <div style={{ marginTop: '8px' }}>
          <p style={{ margin: 0 }}>Virement à effectuer (simulation — aucun fonds réel) :</p>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 12px', margin: '4px 0 0' }}>
            <dt>Bénéficiaire</dt>
            <dd style={{ margin: 0 }}>{call.payment_instructions.beneficiary}</dd>
            <dt>Banque</dt>
            <dd style={{ margin: 0 }}>{call.payment_instructions.bank}</dd>
            <dt>IBAN</dt>
            <dd style={{ margin: 0 }}>{call.payment_instructions.iban}</dd>
            <dt>Montant</dt>
            <dd style={{ margin: 0 }}>{formatAmount(call.amount, call.currency)}</dd>
            <dt>Référence à indiquer</dt>
            <dd style={{ margin: 0 }}><strong data-testid="payment-reference">{call.payment_reference}</strong></dd>
          </dl>
          <DeclareForm call={call} onDeclared={onChanged} />
        </div>
      )}
    </li>
  );
}

export function ClientPaymentCallsPanel({ reservationId }: { reservationId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyPaymentCalls(reservationId), [reservationId]);

  if (state.status === 'loading') return null;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger vos appels de fonds." onRetry={state.refetch} />;
  }
  if (state.data.length === 0) return null;

  return (
    <section aria-label="Appels de fonds" style={{ marginTop: '8px' }}>
      <strong>Appels de fonds</strong>
      <p style={{ margin: '2px 0 4px', fontSize: '12px' }}>Simulation — aucun fonds réel n&apos;est demandé.</p>
      <ul style={{ margin: 0, padding: 0 }}>
        {state.data.map((call) => (
          <CallRow
            key={`${call.id}-${call.settlement}-${call.notice?.id ?? ''}-${call.notice?.status ?? ''}`}
            call={call}
            onChanged={state.refetch}
          />
        ))}
      </ul>
    </section>
  );
}
