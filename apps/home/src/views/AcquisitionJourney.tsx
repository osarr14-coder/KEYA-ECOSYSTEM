import { useState } from 'react';

import {
  ApiErrorBanner, Button, Card, Pill, type PillTone, ProgressBar, SimulatedMark, Skeleton, Stepper, TrustLevels,
  type StepperStep, formatSurface, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type {
  ClientPaymentCall, ContractVersion, PaymentSchedule, Reservation, WorksiteMilestone,
} from '../api/types';
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

/** Message d'état de la réservation (repris de F-066/F-071). Audit UI R1
 * (J07, PO-2026-09-27-05) : KEYIMMO examine le dossier, jamais ne le
 * « valide » ; un virement signalé n'est pas un encaissement. */
export function reservationMessage(reservation: Reservation) {
  switch (reservation.status) {
    case 'held':
      return reservation.validated_at
        ? `Bien bloqué pour vous jusqu'au ${formatDateTime(reservation.held_until)}. Réglez les frais de réservation, `
          + 'puis signalez votre virement : il sera pris en compte une fois encaissé et rapproché (simulé).'
        : `Bien bloqué pour vous jusqu'au ${formatDateTime(reservation.held_until)}. `
          + 'Votre conseiller examine votre dossier, puis vous envoie l’appel des frais de réservation.';
    case 'reserved':
      return 'Frais de réservation encaissés et rapprochés (simulé) : le bien vous est réservé. '
        + 'Suite : signature du contrat et complément du premier versement.';
    case 'committed':
      return 'Acquisition concrétisée (simulée) : contrat signé et premier versement couvert.';
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
    case 'reserved': return 'info';
    case 'held': return 'alert';
    case 'cancelled': return 'danger';
    default: return 'neutral';
  }
}

const FIRST_PAYMENT_KINDS: ClientPaymentCall['kind'][] = ['frais', 'premier_versement'];

function latestContract(contracts: ContractVersion[]) {
  return [...contracts].sort((a, b) => b.version - a.version)[0];
}

/** Audit UI R1 (C03, C04) — le premier versement, frais inclus : encaissé
 * (rapproché) sur le total fixé par l'échéancier du contrat. */
export function firstPaymentProgress(reservation: Reservation, calls: ClientPaymentCall[]) {
  const total = reservation.payment_schedule ? Number(reservation.payment_schedule.first_payment_amount) : null;
  const received = calls
    .filter((call) => FIRST_PAYMENT_KINDS.includes(call.kind))
    .reduce((sum, call) => sum + settledValue(call), 0);
  return { total, received, remaining: total === null ? null : Math.max(0, total - received) };
}

/** Libellé de l'étape contrat selon l'état réel (audit C01, CDC §6.2). */
export function contractStepLabel(contracts: ContractVersion[]) {
  const latest = latestContract(contracts);
  if (latest?.status === 'signed_simulated') return 'Contrat signé (simulé)';
  if (latest?.status === 'approved') return 'Signature du contrat (simulée)';
  return 'Préparation du contrat';
}

/**
 * Étapes de l'achat, dérivées des états fournis par le serveur. Audit UI R1 :
 * sans étape « Validation KEYIMMO » (C05, PO-2026-09-27-02), frais inclus
 * dans le premier versement (C03), étape contrat fidèle à son état (C01).
 * Premier versement et contrat avancent en parallèle : chacun porte son
 * propre état.
 */
export function acquisitionSteps(
  reservation: Reservation, contracts: ContractVersion[], calls: ClientPaymentCall[] = [],
): StepperStep[] {
  const committed = reservation.status === 'committed';
  const latest = latestContract(contracts);
  const signed = committed || latest?.status === 'signed_simulated';
  const { total, received, remaining } = firstPaymentProgress(reservation, calls);
  const firstPaid = committed || (total !== null && remaining === 0);
  const firstStarted = calls.some((call) => FIRST_PAYMENT_KINDS.includes(call.kind));
  const currency = reservation.currency;
  const firstCaption = total === null
    ? 'Frais de réservation inclus'
    : `${formatAmount(String(received), currency)} / ${formatAmount(String(total), currency)}`
      + (remaining ? ` — reste ${formatAmount(String(remaining), currency)} (frais inclus)` : ' (frais inclus)');
  return [
    { id: 'reservation', label: 'Réservation', state: 'done' },
    {
      id: 'first-payment', label: 'Premier versement', caption: firstCaption,
      state: firstPaid ? 'done' : firstStarted || reservation.status === 'held' ? 'current' : 'upcoming',
    },
    {
      id: 'contract', label: contractStepLabel(contracts),
      state: signed ? 'done' : latest || reservation.status === 'reserved' ? 'current' : 'upcoming',
    },
    { id: 'works', label: 'Suivi du chantier', state: committed ? 'current' : 'upcoming' },
  ];
}

export type NextAction =
  | { kind: 'pay'; call: ClientPaymentCall }
  | { kind: 'sign'; contract: ContractVersion }
  | { kind: 'verifying'; call: ClientPaymentCall }
  | { kind: 'wait'; next: string };

/** L'UNIQUE action attendue du client, par ordre de priorité métier :
 * signer un contrat approuvé, payer un appel émis, sinon patienter. */
export function nextAction(reservation: Reservation, calls: ClientPaymentCall[], contracts: ContractVersion[]): NextAction {
  const latest = latestContract(contracts);
  if (latest?.status === 'approved') return { kind: 'sign', contract: latest };
  const open = calls.filter((call) => call.settlement !== 'settled');
  const payable = open.find((call) => canDeclare(call) && call.payment_instructions);
  if (payable) return { kind: 'pay', call: payable };
  const verifying = open.find((call) => call.notice?.status === 'declared');
  if (verifying) return { kind: 'verifying', call: verifying };
  // Audit UI R1 (C02) : rien à faire pour le client → on le dit, puis ce
  // qui va se passer ensuite (jamais une action qui ne lui revient pas).
  if (reservation.status === 'held' && !reservation.validated_at) {
    return { kind: 'wait', next: 'Votre conseiller examine votre dossier, puis vous enverra l’appel des frais de réservation.' };
  }
  if (reservation.status === 'held') return { kind: 'wait', next: 'L’appel des frais de réservation va vous être envoyé.' };
  if (reservation.status === 'committed') {
    return {
      kind: 'wait',
      next: 'Suivi du chantier : chaque palier suivant vous sera appelé après acceptation technique du jalon correspondant.',
    };
  }
  if (!latest || latest.status === 'draft' || latest.status === 'review') {
    return { kind: 'wait', next: 'Votre conseiller prépare votre contrat. Vous serez prévenu pour le signer (signature simulée).' };
  }
  return { kind: 'wait', next: 'Le complément du premier versement va vous être appelé.' };
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

/**
 * PO-2026-09-27-20 (V04, V07, X01) : en-tête du bien sur panneau clair —
 * plus d'aplat navy ni d'icône d'immeuble générique ; programme, lot,
 * surface sans décimales, prix en chiffres tabulaires.
 */
function PropertyHero({ reservation }: { reservation: Reservation }) {
  const facts = [
    reservation.lot.name,
    formatSurface(reservation.lot.surface),
    `Constructeur : ${reservation.organization.name}`,
  ].filter(Boolean);
  return (
    <section
      aria-label="Mon bien"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '20px',
        borderRadius: '6px',
        border: `1px solid ${semanticColors.neutral.border}`,
        background: semanticColors.neutral.surface,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 'clamp(22px, 3vw, 28px)' }}>{reservation.program.name}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 16px', color: semanticColors.neutral.textMuted }}>
        {facts.map((fact) => <span key={fact}>{fact}</span>)}
      </div>
      <span style={{ fontSize: '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: semanticColors.neutral.heading }}>
        {formatAmount(reservation.price_amount, reservation.currency)}
      </span>
      {/* Audit UI R1 (X03) : date complète dans l'en-tête du dossier. */}
      <p data-testid="reservation-dates" style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
        {`Réservation du ${formatDateTime(reservation.created_at)}`}
        {reservation.status === 'held' && ` · bien bloqué jusqu'au ${formatDateTime(reservation.held_until)}`}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <Pill tone={reservationTone(reservation)} data-testid="reservation-status">{reservation.status_label}</Pill>
        <SimulatedMark detail="Paiements et signature" />
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
    // PO-2026-09-28-09 : rien n'est demandé au client pendant la vérification.
    title = 'Aucune action de votre part — Finance vérifie votre virement au relevé';
    amount = action.call;
  } else {
    title = 'Aucune action de votre part pour le moment';
  }

  return (
    <section
      aria-label="Votre prochaine action"
      data-testid="next-action"
      data-kind={action.kind}
      style={{
        background: semanticColors.neutral.surface,
        // PO-2026-09-27-20 (V05, V06) : cadre encre 1 px quand une action est
        // attendue, jamais doré ; aucune ombre.
        border: `1px solid ${action.kind === 'pay' || action.kind === 'sign' ? semanticColors.neutral.heading : semanticColors.neutral.border}`,
        borderRadius: '6px',
        padding: 'clamp(18px, 3vw, 28px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: semanticColors.neutral.textMuted }}>
            {action.kind === 'pay' || action.kind === 'sign' ? 'Votre prochaine action' : 'Où en est votre dossier'}
          </span>
          <h3 style={{ margin: 0, fontSize: '24px' }}>{title}</h3>
          {action.kind === 'wait' && <p style={{ margin: 0, fontWeight: 600 }} data-testid="next-step">{action.next}</p>}
          <p style={{ margin: 0, color: semanticColors.neutral.text }}>
            {/* PO-2026-09-28-09 : pendant la vérification, aucune consigne de paiement. */}
            {action.kind === 'verifying' && reservation.status === 'held'
              ? `Bien bloqué pour vous jusqu'au ${formatDateTime(reservation.held_until)}. Votre virement est signalé : `
                + 'il sera pris en compte une fois encaissé et rapproché (simulé). Vous serez prévenu.'
              : reservationMessage(reservation)}
          </p>
        </div>
        {amount && (
          <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
            <div style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>Montant</div>
            <div style={{ fontSize: '24px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: semanticColors.neutral.heading }}>
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

/**
 * Audit UI R1 (C04, C07) — repère principal : le premier versement (frais
 * inclus), pas le prix total, qui reste une information secondaire. Seul
 * l'encaissé et rapproché compte : un virement signalé n'y figure pas.
 */
function FinancialSummary({ reservation, calls }: { reservation: Reservation; calls: ClientPaymentCall[] }) {
  const { total, received, remaining } = firstPaymentProgress(reservation, calls);
  const percentage = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <Card title="Suivi financier" aria-label="Suivi financier">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
        <span style={{ color: semanticColors.neutral.textMuted, fontSize: '14px' }}>Premier versement — encaissé et rapproché (simulé)</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <span data-testid="settled-total" style={{ fontSize: '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: semanticColors.neutral.heading }}>
            {formatAmount(String(received), reservation.currency)}
          </span>
          {total !== null && (
            <span style={{ color: semanticColors.neutral.textMuted, fontSize: '14px' }}>
              {`/ ${formatAmount(String(total), reservation.currency)}`}
            </span>
          )}
        </div>
        {remaining !== null && remaining > 0 && (
          <span data-testid="first-payment-remaining" style={{ fontSize: '14px' }}>
            {`Reste ${formatAmount(String(remaining), reservation.currency)} (frais de réservation inclus)`}
          </span>
        )}
      </div>
      {total !== null && <ProgressBar percentage={percentage} width="100%" aria-label="Part du premier versement encaissée" />}
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
          <span style={{ flex: 1 }}>Prix total du bien (fictif)</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmount(reservation.price_amount, reservation.currency)}</span>
        </li>
      </ul>
    </Card>
  );
}

/** Audit UI R1 (C06) — échéancier contractuel fictif : montant et
 * condition réelle de chaque appel (barème du Country Pack, sans date). */
export function PaymentScheduleCard({ schedule, currency }: { schedule: PaymentSchedule; currency: string }) {
  return (
    <Card title="Échéancier du contrat (fictif)" aria-label="Échéancier du contrat">
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {schedule.rows.map((row) => (
          <li key={row.code} data-testid="schedule-row" style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingBottom: '12px', borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span style={{ flex: '1 1 140px', fontWeight: 600 }}>{row.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmount(row.amount, currency)}</span>
            </div>
            <span data-testid="schedule-planned" style={{ fontSize: '14px' }}>
              {`Date prévisionnelle (fictive) : ${formatDate(row.planned_on)}`}
            </span>
            <span style={{ fontSize: '14px', color: semanticColors.neutral.textMuted }}>
              {row.fee_included ? `Dont frais de réservation : ${formatAmount(row.fee_included, currency)}. ${row.condition}` : row.condition}
            </span>
          </li>
        ))}
      </ol>
      <p style={{ margin: '12px 0 0', fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        {`Barème Country Pack ${schedule.country_pack}, version ${schedule.version} — valeurs de démonstration${schedule.legally_validated ? '' : ', non validées juridiquement'}. `}
        Dates prévisionnelles, sans valeur d’échéance : chaque appel est émis par votre conseiller.
      </p>
    </Card>
  );
}

function AdvisorCard() {
  return (
    <Card title="Votre conseiller" aria-label="Votre conseiller">
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
            Examine votre dossier, prépare votre contrat et vous prévient à chaque étape.
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

const WORKSITE_TONE: Record<WorksiteMilestone['cdc_state'], PillTone> = {
  DRAFT: 'neutral', SUBMITTED: 'alert', UNDER_REVIEW: 'info', CHANGES_REQUESTED: 'alert', RESUBMITTED: 'info',
  TECHNICALLY_ACCEPTED: 'success',
};

/**
 * PO-2026-09-28-04 — suivi du chantier du bien : chaque jalon avec son état
 * (CDC §7.1) et l'échelle des niveaux de confiance, chaque niveau atteint
 * disant qui, quand, sur quelle version et dans quel périmètre. Jamais un
 * score ni un pourcentage.
 */
function WorksiteCard({ reservationId }: { reservationId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyWorksite(reservationId), [reservationId]);
  return (
    <Card title="Suivi du chantier" icon="building" aria-label="Suivi du chantier">
      {state.status === 'loading' && <Skeleton lines={3} label="Chargement du chantier" />}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger le suivi du chantier." onRetry={state.refetch} />
      )}
      {state.status === 'success' && state.data.length === 0 && (
        <p style={{ margin: 0 }}>Aucun jalon n’est encore défini pour votre bien.</p>
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {state.data.map((milestone) => (
            <li
              key={milestone.id}
              data-testid="worksite-milestone"
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px', borderTop: `1px solid ${semanticColors.neutral.border}` }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <strong>{`${milestone.order}. ${milestone.label}`}</strong>
                <Pill tone={WORKSITE_TONE[milestone.cdc_state]}>{milestone.status_label}</Pill>
              </div>
              {milestone.status_hint && (
                <span style={{ fontSize: '14px', color: semanticColors.neutral.textMuted }}>{milestone.status_hint}</span>
              )}
              <TrustLevels reached={milestone.trust_levels} aria-label={`Niveaux de confiance — ${milestone.label}`} />
            </li>
          ))}
        </ol>
      )}
    </Card>
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
        <Stepper steps={acquisitionSteps(reservation, contracts, calls)} aria-label="Étapes de mon acquisition" />
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
          {(reservation.status === 'reserved' || reservation.status === 'committed') && (
            <WorksiteCard reservationId={reservation.id} />
          )}
        </div>
        <aside style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <FinancialSummary reservation={reservation} calls={calls} />
          {reservation.payment_schedule && (
            <PaymentScheduleCard schedule={reservation.payment_schedule} currency={reservation.currency} />
          )}
          <AdvisorCard />
          {reservation.status === 'held' && <CancelReservation reservation={reservation} onChanged={onChanged} />}
        </aside>
      </div>
    </article>
  );
}
