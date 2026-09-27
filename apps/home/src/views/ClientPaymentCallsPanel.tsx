import { type FormEvent, type ReactNode, useState } from 'react';

import {
  Button, Input, Pill, type PillTone, semanticColors, SimulatedMark,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { ClientPaymentCall } from '../api/types';
import { formatDate } from '../format';

/**
 * Ticket F-068 — appels de fonds du client (backend B-050/B-051, CDC V3
 * §8.1) : montant appelé et état de couverture, tels que calculés par le
 * serveur.
 *
 * Ticket F-071 (backend B-056) — le client PAIE : instructions de virement
 * (compte FICTIF, référence propre à l'appel) puis « J'ai effectué le
 * virement ». Sa déclaration n'est pas une preuve : l'appel n'est « couvert »
 * qu'une fois le virement confirmé par Finance (KEYIMMO).
 *
 * Audit UI R1 (PO-2026-09-27-05, C07) : la déclaration du client est un
 * simple SIGNALEMENT ; seul l'encaissement simulé enregistré et rapproché
 * par Finance fait foi. Libellés : « Virement signalé — non encaissé »,
 * « Encaissé et rapproché (simulé) ».
 *
 * Ticket F-074 (direction « Confiance premium ») — composants
 * PRÉSENTATIONNELS : les appels sont chargés une seule fois par le parcours
 * d'acquisition (`AcquisitionJourney`), qui en dérive aussi les étapes et la
 * prochaine action.
 */

export const SETTLEMENT_LABELS: Record<NonNullable<ClientPaymentCall['settlement']>, string> = {
  to_pay: 'À régler',
  partial: 'Partiellement encaissé (simulé)',
  settled: 'Encaissé et rapproché (simulé)',
};

export const SIGNALLED_LABEL = 'Virement signalé — non encaissé';

export function settlementTone(call: ClientPaymentCall): PillTone {
  if (call.settlement === 'settled') return 'success';
  if (call.notice?.status === 'declared') return 'primary';
  if (call.settlement === 'partial') return 'alert';
  return 'accent';
}

export function settlementText(call: ClientPaymentCall) {
  if (call.settlement !== 'settled' && call.notice?.status === 'declared') return SIGNALLED_LABEL;
  return call.settlement ? SETTLEMENT_LABELS[call.settlement] : '—';
}

export function callLabel(call: ClientPaymentCall) {
  return call.tier_label ? `${call.kind_label} — ${call.tier_label}` : call.kind_label;
}

export function formatCallAmount(value: string | null, currency: string) {
  if (value === null) return '—';
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`;
}

/** Un appel encore déclarable : ni couvert, ni déjà en vérification. */
export function canDeclare(call: ClientPaymentCall) {
  return call.settlement !== 'settled' && call.notice?.status !== 'declared';
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

const fieldLabelStyle = {
  display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600,
} as const;

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
      setError(errorDetail(caught, 'Le signalement a échoué. Réessayez.'));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label={`Signaler mon virement — ${call.kind_label}`}
      style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}
    >
      <label style={{ ...fieldLabelStyle, flex: '1 1 200px' }}>
        Référence de mon virement
        <Input
          aria-label="Référence de mon virement"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          required
          placeholder="ex. VIR-0001"
        />
      </label>
      <label style={{ ...fieldLabelStyle, flex: '0 1 180px' }}>
        Date du virement
        <Input
          aria-label="Date du virement"
          type="date"
          value={paidOn}
          onChange={(event) => setPaidOn(event.target.value)}
          required
        />
      </label>
      <Button type="submit" variant="accent" disabled={submitting || reference.trim() === ''}>
        {submitting ? 'Envoi…' : 'Signaler mon virement'}
      </Button>
      {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function InstructionField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <dt
        style={{
          fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: semanticColors.neutral.textMuted,
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  );
}

/**
 * Un appel de fonds : libellé, montant, état ; les messages de déclaration
 * (en vérification, rejetée) ; et, s'il reste à payer, les instructions de
 * virement et le formulaire de déclaration.
 */
export function CallRow({ call, onChanged }: { call: ClientPaymentCall; onChanged: () => void }) {
  const notice = call.notice ?? null;
  const settled = call.settlement === 'settled';
  const awaitingConfirmation = notice?.status === 'declared';

  return (
    <li data-testid="payment-call" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <strong>{callLabel(call)}</strong>
        <span>{` : ${formatCallAmount(call.amount, call.currency)} · `}</span>
        <Pill tone={settlementTone(call)} data-testid="payment-call-settlement">{settlementText(call)}</Pill>
        {call.settlement === 'partial' && <span>{` (${formatCallAmount(call.settled_amount, call.currency)} encaissés)`}</span>}
      </div>

      {awaitingConfirmation && notice && (
        <p style={{ margin: 0 }} data-testid="payment-notice">
          {`Virement signalé le ${formatDate(notice.paid_on)} (réf. ${notice.client_reference}). `
            + 'Ce signalement ne vaut pas encaissement : Finance l’enregistre quand le virement figure au relevé (simulé).'}
        </p>
      )}
      {notice?.status === 'rejected' && !settled && (
        <p role="status" style={{ margin: 0, color: semanticColors.danger.text }} data-testid="payment-notice">
          {`Virement introuvable au relevé (simulé) : ${notice.rejection_reason}. Vérifiez votre virement puis signalez-le à nouveau.`}
        </p>
      )}

      {canDeclare(call) && call.payment_instructions && (
        <>
          <dl
            aria-label="Virement à effectuer (simulé)"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '14px 20px',
              margin: 0,
              padding: '18px',
              borderRadius: '16px',
              background: semanticColors.neutral.subtle,
            }}
          >
            <InstructionField label="Bénéficiaire">{call.payment_instructions.beneficiary}</InstructionField>
            <InstructionField label="Banque">{call.payment_instructions.bank}</InstructionField>
            <InstructionField label="IBAN">{call.payment_instructions.iban}</InstructionField>
            <InstructionField label="Montant">{formatCallAmount(call.amount, call.currency)}</InstructionField>
            <InstructionField label="Référence à indiquer">
              <span
                data-testid="payment-reference"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '16px', color: semanticColors.neutral.heading,
                }}
              >
                {call.payment_reference}
              </span>
            </InstructionField>
          </dl>
          <DeclareForm call={call} onDeclared={onChanged} />
          <SimulatedMark detail="Virement" />
          <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
            Votre signalement est un simple avis : seul l’encaissement enregistré et rapproché par Finance fait foi.
          </p>
        </>
      )}
    </li>
  );
}
