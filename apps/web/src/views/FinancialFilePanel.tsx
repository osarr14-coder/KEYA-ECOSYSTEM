import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Input, Select, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type {
  AdminReservation, CustomerReceipt, PaymentCall, PaymentCallCandidate, Settlement,
} from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-068 — dossier financier d'une réservation (backend B-050/B-051,
 * CDC V3 §8.1) : l'ADV (ou l'admin) ÉMET les appels de fonds calculés par le
 * serveur ; Finance ENREGISTRE les encaissements simulés, les AFFECTE aux
 * appels et les RAPPROCHE. Les transitions de la réservation (Réservée,
 * Concrétisée) sont automatiques côté serveur : aucun bouton ici ne les
 * déclenche. Tous les montants viennent du serveur, jamais recalculés.
 */

export const SIMULATION_NOTICE = 'SIMULÉ — AUCUN FONDS RÉEL · DÉMONSTRATION — DONNÉES FICTIVES';

const ACTIVE_STATUSES: AdminReservation['status'][] = ['held', 'reserved', 'committed'];

const SETTLEMENT_LABELS: Record<Settlement, string> = {
  to_pay: 'À payer',
  partial: 'Partiellement couvert',
  settled: 'Couvert',
};

export function formatAmount(value: string | null, currency = 'XOF') {
  if (value === null) return '—';
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function callLabel(call: PaymentCall | PaymentCallCandidate) {
  return call.tier_label ? `${call.kind_label} — ${call.tier_label}` : call.kind_label;
}

const blockStyle = {
  border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '8px', padding: '12px', marginTop: '8px',
} as const;

function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>, fallback: string) {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, fallback));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}

function CandidateButton({
  candidate, reservation, onIssued,
}: { candidate: PaymentCallCandidate; reservation: AdminReservation; onIssued: () => void }) {
  const api = useApiClient();
  const { pending, error, run } = useAction();
  return (
    <div style={{ marginTop: '4px' }}>
      <Button
        type="button"
        variant="secondary"
        disabled={!candidate.available || pending}
        onClick={() => {
          void run(
            () => api.issuePaymentCall(reservation.id, reservation.organization.id, candidate.kind, candidate.tier_code),
            "Échec de l'émission.",
          ).then((ok) => { if (ok) onIssued(); });
        }}
      >
        {`Émettre l'appel : ${callLabel(candidate)} (${formatAmount(candidate.amount)})`}
      </Button>
      {candidate.reason && <span style={{ marginLeft: '8px', fontSize: '13px' }}>{candidate.reason}</span>}
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </div>
  );
}

function ReceiptForm({ reservation, onRecorded }: { reservation: AdminReservation; onRecorded: () => void }) {
  const api = useApiClient();
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());
  const { pending, error, run } = useAction();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () => api.recordReceipt(reservation.id, reservation.organization.id, {
        bank_reference: reference.trim(), amount: amount.trim(), received_on: receivedOn,
      }),
      "Échec de l'enregistrement.",
    );
    if (ok) {
      setReference('');
      setAmount('');
      onRecorded();
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label={`Enregistrer un encaissement — ${reservation.lot.name}`}
      style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '8px' }}
    >
      <label>
        Référence bancaire simulée
        <Input aria-label="Référence bancaire simulée" value={reference} onChange={(event) => setReference(event.target.value)} required style={{ marginTop: '4px', width: '200px' }} />
      </label>
      <label>
        Montant reçu (XOF)
        <Input aria-label="Montant reçu" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} required style={{ marginTop: '4px', width: '160px' }} />
      </label>
      <label>
        Reçu le
        <Input aria-label="Date de réception" type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} required style={{ marginTop: '4px' }} />
      </label>
      <Button type="submit" disabled={pending || reference.trim() === '' || amount.trim() === ''}>
        {pending ? 'Enregistrement…' : "Enregistrer l'encaissement"}
      </Button>
      {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function ReceiptBlock({
  receipt, calls, organizationId, canAct, onChanged,
}: {
  receipt: CustomerReceipt; calls: PaymentCall[]; organizationId: string; canAct: boolean; onChanged: () => void;
}) {
  const api = useApiClient();
  const openCalls = calls.filter((call) => Number(call.allocated_amount ?? 0) < Number(call.amount));
  const [callId, setCallId] = useState(openCalls[0]?.id ?? '');
  const [amount, setAmount] = useState(receipt.unallocated_amount ?? '');
  const { pending, error, run } = useAction();
  const unallocated = Number(receipt.unallocated_amount ?? 0);
  const callLabels = new Map(calls.map((call) => [call.id, callLabel(call)]));

  return (
    <article aria-label={`Encaissement ${receipt.bank_reference}`} style={blockStyle}>
      <p style={{ margin: 0 }}>
        <strong>{receipt.bank_reference}</strong>
        {` · ${formatAmount(receipt.amount, receipt.currency)} reçus le ${receipt.received_on} · `}
        <span data-testid="receipt-status">{receipt.status_label}</span>
        {` · non affecté : ${formatAmount(receipt.unallocated_amount, receipt.currency)}`}
      </p>
      {receipt.allocations.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
          {receipt.allocations.map((allocation) => (
            <li key={allocation.id}>
              {`${formatAmount(allocation.amount, receipt.currency)} affectés à ${callLabels.get(allocation.payment_call) ?? 'un appel'}`}
            </li>
          ))}
        </ul>
      )}
      {canAct && unallocated > 0 && openCalls.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => api.allocateReceipt(receipt.id, organizationId, callId, String(amount).trim()),
              "Échec de l'affectation.",
            ).then((ok) => { if (ok) onChanged(); });
          }}
          aria-label={`Affecter l'encaissement ${receipt.bank_reference}`}
          style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '8px' }}
        >
          <label>
            Appel
            <Select aria-label="Appel à couvrir" value={callId} onChange={(event) => setCallId(event.target.value)} style={{ marginTop: '4px' }}>
              {openCalls.map((call) => (
                <option key={call.id} value={call.id}>{`${callLabel(call)} (${formatAmount(call.amount, call.currency)})`}</option>
              ))}
            </Select>
          </label>
          <label>
            Montant affecté
            <Input aria-label="Montant affecté" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} style={{ marginTop: '4px', width: '160px' }} />
          </label>
          <Button type="submit" variant="secondary" disabled={pending || callId === ''}>Affecter</Button>
        </form>
      )}
      {canAct && receipt.status === 'bank_executed_sim' && (
        <Button
          type="button"
          style={{ marginTop: '8px' }}
          disabled={pending}
          onClick={() => {
            void run(() => api.reconcileReceipt(receipt.id, organizationId), 'Rapprochement refusé.')
              .then((ok) => { if (ok) onChanged(); });
          }}
        >
          Rapprocher
        </Button>
      )}
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </article>
  );
}

export function FinancialFilePanel({
  reservation, canIssueCalls, canRecordMovements, onChanged,
}: {
  reservation: AdminReservation;
  canIssueCalls: boolean;
  canRecordMovements: boolean;
  onChanged: () => void;
}) {
  const api = useApiClient();
  const organizationId = reservation.organization.id;
  const state = useApiResource(
    () => Promise.all([
      api.getFinanceFile(reservation.id, organizationId),
      canIssueCalls ? api.getTeamPaymentCalls(reservation.id, organizationId) : Promise.resolve(null),
    ]),
    [reservation.id, organizationId, canIssueCalls],
  );

  if (!ACTIVE_STATUSES.includes(reservation.status)) return null;
  if (state.status === 'loading') return <p style={{ margin: '8px 0 0' }}>Chargement du dossier financier…</p>;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger le dossier financier." onRetry={state.refetch} />;
  }

  const [file, team] = state.data;
  // Une affectation ou un rapprochement peut faire avancer la réservation :
  // la liste parente est rechargée avec le dossier.
  const refresh = () => { state.refetch(); onChanged(); };

  return (
    <section aria-label={`Dossier financier — ${reservation.lot.name}`} style={{ marginTop: '12px' }}>
      <strong>Dossier financier</strong>
      <p style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em' }}>{SIMULATION_NOTICE}</p>

      <h4 style={{ margin: '8px 0 4px' }}>Appels de fonds</h4>
      {file.calls.length === 0 && <p style={{ margin: 0 }}>Aucun appel émis.</p>}
      {file.calls.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Appel</th>
              <th style={{ textAlign: 'right' }}>Montant</th>
              <th style={{ textAlign: 'right' }}>Couvert (rapproché)</th>
              <th style={{ textAlign: 'left', paddingLeft: '12px' }}>État</th>
            </tr>
          </thead>
          <tbody>
            {file.calls.map((call) => (
              <tr key={call.id}>
                <td>{callLabel(call)}</td>
                <td style={{ textAlign: 'right' }}>{formatAmount(call.amount, call.currency)}</td>
                <td style={{ textAlign: 'right' }}>{formatAmount(call.settled_amount, call.currency)}</td>
                <td style={{ paddingLeft: '12px' }} data-testid="call-settlement">
                  {call.settlement ? SETTLEMENT_LABELS[call.settlement] : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {team && team.blocking_reason && <p style={{ margin: '4px 0 0' }}>{team.blocking_reason}</p>}
      {team && team.candidates.map((candidate) => (
        <CandidateButton
          key={`${candidate.kind}-${candidate.tier_code}`}
          candidate={candidate}
          reservation={reservation}
          onIssued={refresh}
        />
      ))}

      <h4 style={{ margin: '12px 0 4px' }}>Encaissements</h4>
      {file.receipts.length === 0 && <p style={{ margin: 0 }}>Aucun encaissement enregistré.</p>}
      {file.receipts.map((receipt) => (
        <ReceiptBlock
          key={`${receipt.id}-${receipt.allocations.length}-${receipt.status}`}
          receipt={receipt}
          calls={file.calls}
          organizationId={organizationId}
          canAct={canRecordMovements}
          onChanged={refresh}
        />
      ))}
      {canRecordMovements && <ReceiptForm reservation={reservation} onRecorded={refresh} />}
    </section>
  );
}
