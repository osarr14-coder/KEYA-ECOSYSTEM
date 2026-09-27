import { useState } from 'react';

import {
  ApiErrorBanner, BRAND_GRADIENT, Button, Card, Icon, Pill, type PillTone, ProgressBar, Stepper, type StepperStep,
  brandColors, semanticColors, typography,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { ClientPaymentCall, ContractVersion, Reservation } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { formatAmount, formatDate, formatDateTime } from '../format';
import { ContractVersions } from './ClientContractPanel';
import {
  CallRow, callLabel, canDeclare, formatCallAmount, settlementText, settlementTone,
} from './ClientPaymentCallsPanel';

/**
 * Ticket F-074 (direction « Confiance premium ») — le parcours
 * d'acquisition d'UNE réservation active, pensé pour un client non
 * spécialiste : son bien, les 6 étapes de l'achat, UNE prochaine action
 * claire, son suivi financier et son contrat. Toutes les décisions restent
 * au serveur (statuts, couverture, signabilité) : cet écran les met en
 * forme, il ne les recalcule jamais.
 */

/** Message d'état de la réservation (repris de F-066/F-071). */
export function reservationMessage(reservation: Reservation) {
  switch (reservation.status) {
    case 'held':
      return reservation.validated_at
        ? `Réservation validée par KEYIMMO. Réglez les frais de réservation ci-dessous avant le ${formatDateTime(reservation.held_until)}, `
          + 'puis déclarez votre virement : KEYIMMO le confirmera à réception.'
        : `Bien bloqué pour vous jusqu'au ${formatDateTime(reservation.held_until)}. `
          + 'Votre demande est en attente de validation par votre conseiller KEYIMMO, qui vous enverra ensuite l’appel des frais de réservation.';
    case 'reserved':
      return 'Frais de réservation encaissés : le bien vous est réservé. '
        + 'Prochaine étape : signature du contrat et complément du premier versement.';
    case 'committed':
      return 'Acquisition concrétisée (simulation) : contrat signé et premier versement couvert.';
    case 'expired':
      return 'Le délai de blocage est écoulé sans versement : le bien a été libéré.';
    case 'cancelled':
      return reservation.cancellation_reason
        ? `Réservation annulée — motif : ${reservation.cancellation_reason}`
        : 'Réservation annulée.';
    default:
      return reservation.status_label;
  }
}

export function reservationTone(reservation: Reservation): PillTone {
  switch (reservation.status) {
    case 'committed': return 'success';
    case 'reserved': return 'primary';
    case 'held': return 'accent';
    case 'cancelled': return 'danger';
    default: return 'neutral';
  }
}

const PAID_STATUSES: Reservation['status'][] = ['reserved', 'committed'];

/** Les 6 étapes de l'achat, dérivées des états fournis par le serveur. */
export function acquisitionSteps(reservation: Reservation, contracts: ContractVersion[]): StepperStep[] {
  const validated = Boolean(reservation.validated_at) || PAID_STATUSES.includes(reservation.status);
  const feesPaid = PAID_STATUSES.includes(reservation.status);
  const signed = reservation.status === 'committed' || contracts.some((contract) => contract.status === 'signed_simulated');
  const committed = reservation.status === 'committed';
  const done = [true, validated, feesPaid, signed, committed, false];
  const labels: [string, string][] = [
    ['reservation', 'Réservation'],
    ['validation', 'Validation KEYIMMO'],
    ['fees', 'Frais de réservation'],
    ['contract', 'Signature du contrat'],
    ['first-payment', 'Premier versement'],
    ['works', 'Suivi du chantier'],
  ];
  const currentIndex = done.findIndex((isDone) => !isDone);
  return labels.map(([id, label], index) => ({
    id,
    label,
    state: done[index] ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

export type NextAction =
  | { kind: 'pay'; call: ClientPaymentCall }
  | { kind: 'sign'; contract: ContractVersion }
  | { kind: 'verifying'; call: ClientPaymentCall }
  | { kind: 'wait'; title: string };

/** L'UNIQUE action attendue du client, par ordre de priorité métier :
 * signer un contrat approuvé, payer un appel émis, sinon patienter. */
export function nextAction(reservation: Reservation, calls: ClientPaymentCall[], contracts: ContractVersion[]): NextAction {
  const latest = [...contracts].sort((a, b) => b.version - a.version)[0];
  if (latest?.status === 'approved') return { kind: 'sign', contract: latest };
  const open = calls.filter((call) => call.settlement !== 'settled');
  const payable = open.find((call) => canDeclare(call) && call.payment_instructions);
  if (payable) return { kind: 'pay', call: payable };
  const verifying = open.find((call) => call.notice?.status === 'declared');
  if (verifying) return { kind: 'verifying', call: verifying };
  if (reservation.status === 'held' && !reservation.validated_at) return { kind: 'wait', title: 'Validation de votre dossier' };
  if (reservation.status === 'held') return { kind: 'wait', title: 'Appel des frais de réservation' };
  if (reservation.status === 'committed') return { kind: 'wait', title: 'Suivi de votre chantier' };
  if (contracts.length === 0) return { kind: 'wait', title: 'Préparation de votre contrat' };
  return { kind: 'wait', title: 'Prochain appel de fonds' };
}

function settledValue(call: ClientPaymentCall) {
  if (call.settled_amount !== null) return Number(call.settled_amount);
  return call.settlement === 'settled' ? Number(call.amount) : 0;
}

function errorDetail(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && caught.body && typeof caught.body === 'object' && 'detail' in caught.body) {
    return String((caught.body as { detail: unknown }).detail);
  }
  return fallback;
}

function PropertyHero({ reservation }: { reservation: Reservation }) {
  const facts = [
    reservation.lot.name,
    reservation.lot.surface ? `${Number(reservation.lot.surface).toLocaleString('fr-FR')} m²` : null,
    reservation.organization.name,
  ].filter(Boolean);
  return (
    <section
      aria-label="Mon bien"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        borderRadius: '24px',
        overflow: 'hidden',
        background: BRAND_GRADIENT,
        color: '#FFFFFF',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          flex: '0 0 220px',
          minHeight: '160px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, rgba(196, 154, 44, 0.35), rgba(196, 154, 44, 0.08))',
          color: '#E2C47A',
        }}
      >
        <Icon name="building" size={56} />
      </div>
      <div style={{ flex: '1 1 320px', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#E2C47A' }}>
          Mon acquisition · démonstration
        </span>
        <h2 style={{ margin: 0, color: '#FFFFFF', fontSize: 'clamp(24px, 3vw, 32px)' }}>{reservation.program.name}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px', color: '#D5DCE8' }}>
          {facts.map((fact) => <span key={fact}>{fact}</span>)}
          <span style={{ fontFamily: typography.headingFontFamily, fontSize: '22px', fontWeight: 600, color: '#FFFFFF' }}>
            {formatAmount(reservation.price_amount, reservation.currency)}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <Pill tone={reservationTone(reservation)} data-testid="reservation-status">{reservation.status_label}</Pill>
          <span
            style={{
              padding: '3px 12px', borderRadius: '999px', border: '1px solid rgba(226, 196, 122, 0.5)', color: '#E2C47A', fontSize: '13px', fontWeight: 600,
            }}
          >
            Simulation — aucun fonds réel
          </span>
        </div>
      </div>
    </section>
  );
}

function NextActionCard({
  reservation, action, onChanged,
}: { reservation: Reservation; action: NextAction; onChanged: () => void }) {
  let title: string;
  let amount: ClientPaymentCall | null = null;
  if (action.kind === 'pay') {
    title = `Régler : ${callLabel(action.call)}`;
    amount = action.call;
  } else if (action.kind === 'sign') {
    title = `Signer votre contrat (version ${action.contract.version})`;
  } else if (action.kind === 'verifying') {
    title = 'Virement en cours de vérification';
    amount = action.call;
  } else {
    title = action.title;
  }

  return (
    <section
      aria-label="Votre prochaine action"
      data-testid="next-action"
      data-kind={action.kind}
      style={{
        background: semanticColors.neutral.surface,
        border: `2px solid ${action.kind === 'pay' || action.kind === 'sign' ? semanticColors.accent.solid : semanticColors.neutral.border}`,
        borderRadius: '20px',
        padding: 'clamp(18px, 3vw, 28px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        boxShadow: 'var(--keya-shadow-md)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: semanticColors.accent.text }}>
            Votre prochaine action
          </span>
          <h3 style={{ margin: 0, fontSize: '24px' }}>{title}</h3>
          <p style={{ margin: 0, color: semanticColors.neutral.text }}>{reservationMessage(reservation)}</p>
        </div>
        {amount && (
          <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
            <div style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>Montant</div>
            <div style={{ fontFamily: typography.headingFontFamily, fontSize: '28px', fontWeight: 600, color: semanticColors.neutral.heading }}>
              {formatCallAmount(amount.amount, amount.currency)}
            </div>
          </div>
        )}
      </div>
      {(action.kind === 'pay' || action.kind === 'verifying') && (
        <ul style={{ margin: 0, padding: 0 }}>
          <CallRow call={action.call} onChanged={onChanged} />
        </ul>
      )}
      {action.kind === 'sign' && (
        <p style={{ margin: 0, fontWeight: 600 }}>Lisez la version ci-dessous (« Mon contrat »), cochez la case puis signez.</p>
      )}
    </section>
  );
}

function FinancialSummary({ reservation, calls }: { reservation: Reservation; calls: ClientPaymentCall[] }) {
  const price = Number(reservation.price_amount);
  const settled = calls.reduce((sum, call) => sum + settledValue(call), 0);
  const percentage = price > 0 ? Math.min(100, Math.round((settled / price) * 100)) : 0;
  return (
    <Card title="Suivi financier" aria-label="Suivi financier">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <span style={{ color: semanticColors.neutral.textMuted }}>Réglé</span>
        <span data-testid="settled-total" style={{ fontFamily: typography.headingFontFamily, fontSize: '22px', fontWeight: 600, color: semanticColors.neutral.heading }}>
          {formatAmount(String(settled), reservation.currency)}
        </span>
        <span style={{ color: semanticColors.neutral.textMuted, fontSize: '14px' }}>
          {`/ ${formatAmount(reservation.price_amount, reservation.currency)}`}
        </span>
      </div>
      <ProgressBar percentage={percentage} width="100%" fillColor={brandColors.gold} aria-label="Part du prix réglée" />
      <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {calls.map((call) => (
          <li
            key={call.id}
            data-testid="summary-call"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingBottom: '12px', borderBottom: `1px solid ${semanticColors.neutral.border}` }}
          >
            <span style={{ flex: '1 1 140px', fontWeight: 600 }}>{callLabel(call)}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCallAmount(call.amount, call.currency)}</span>
            <Pill tone={settlementTone(call)}>{settlementText(call)}</Pill>
          </li>
        ))}
        <li style={{ display: 'flex', gap: '8px', color: semanticColors.neutral.textMuted, fontSize: '14px' }}>
          <span style={{ flex: 1 }}>Paliers de travaux</span>
          <span>selon l&apos;avancement du chantier</span>
        </li>
      </ul>
    </Card>
  );
}

function AdvisorCard() {
  return (
    <Card eyebrow="Votre conseiller KEYIMMO" aria-label="Votre conseiller">
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <span
          aria-hidden="true"
          style={{
            width: '44px', height: '44px', flexShrink: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: semanticColors.primary.background, color: semanticColors.primary.text, fontWeight: 700,
          }}
        >
          GA
        </span>
        <div>
          <div style={{ fontWeight: 700 }}>Gestionnaire ADV</div>
          <div style={{ fontSize: '14px', color: semanticColors.neutral.textMuted }}>
            Valide votre dossier, prépare votre contrat et vous notifie à chaque étape.
          </div>
        </div>
      </div>
    </Card>
  );
}

function CancelReservation({ reservation, onChanged }: { reservation: Reservation; onChanged: () => void }) {
  const api = useApiClient();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setSubmitting(true);
    setError(null);
    try {
      await api.cancelMyReservation(reservation.id);
      onChanged();
    } catch (caught) {
      setError(errorDetail(caught, "L'annulation a échoué. Réessayez."));
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {!confirming && (
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
          Annuler cette réservation
        </Button>
      )}
      {confirming && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button type="button" variant="danger" onClick={() => { void cancel(); }} disabled={submitting}>
            {submitting ? 'Annulation…' : "Confirmer l'annulation"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
            Garder la réservation
          </Button>
        </div>
      )}
      {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

export function AcquisitionJourney({ reservation, onChanged }: { reservation: Reservation; onChanged: () => void }) {
  const api = useApiClient();
  const callsState = useApiResource(() => api.getMyPaymentCalls(reservation.id), [reservation.id, reservation.status]);
  const contractsState = useApiResource(() => api.getMyContracts(reservation.id), [reservation.id, reservation.status]);

  function refreshAll() {
    callsState.refetch();
    contractsState.refetch();
    onChanged();
  }

  const calls = callsState.status === 'success' ? callsState.data : [];
  const contracts = contractsState.status === 'success' ? contractsState.data : [];
  const loaded = callsState.status === 'success' && contractsState.status === 'success';

  return (
    <article
      data-testid="reservation"
      aria-label={`Acquisition — ${reservation.program.name}, ${reservation.lot.name}`}
      style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
    >
      <PropertyHero reservation={reservation} />

      <Card aria-label="Étapes de mon acquisition">
        <Stepper steps={acquisitionSteps(reservation, contracts)} aria-label="Étapes de mon acquisition" />
      </Card>

      {callsState.status === 'error' && (
        <ApiErrorBanner error={callsState.error} title="Impossible de charger vos appels de fonds." onRetry={callsState.refetch} />
      )}
      {contractsState.status === 'error' && (
        <ApiErrorBanner error={contractsState.error} title="Impossible de charger le contrat." onRetry={contractsState.refetch} />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {loaded
            ? <NextActionCard reservation={reservation} action={nextAction(reservation, calls, contracts)} onChanged={refreshAll} />
            : <p>Chargement…</p>}
          {contractsState.status === 'success' && (
            <Card title="Mon contrat" icon="file-text" aria-label="Mon contrat">
              <ContractVersions contracts={contracts} onSigned={refreshAll} />
            </Card>
          )}
        </div>
        <aside style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <FinancialSummary reservation={reservation} calls={calls} />
          <AdvisorCard />
          {reservation.status === 'held' && <CancelReservation reservation={reservation} onChanged={onChanged} />}
          <p style={{ margin: 0, fontSize: '13px', color: semanticColors.neutral.textMuted }}>
            {`Réservation du ${formatDate(reservation.created_at)}`}
            {reservation.status === 'held' && ` · bien bloqué jusqu'au ${formatDateTime(reservation.held_until)}`}
          </p>
        </aside>
      </div>
    </article>
  );
}
