import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Card, Input, KeyFigure, PageHeader, Pill, type PillTone, Select, semanticColors, typography, SimulatedMark,
  formatCalendarDate, formatServerDateTime,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { AdminReservation, PaymentNotice, PaymentNoticeReceipt } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { FinancialFilePanel, formatAmount } from './FinancialFilePanel';

/**
 * Ticket F-071 (backend B-056) — virements déclarés par les clients.
 * Finance vérifie le relevé bancaire (simulé) puis CONFIRME (encaissement
 * créé, affecté à l'appel, rapproché : la réservation avance d'elle-même,
 * l'ADV et le client sont notifiés) ou REJETTE avec un motif. L'ADV et
 * l'admin lisent. Une déclaration du client n'est jamais une preuve.
 *
 * Ticket F-078 (direction « Confiance premium ») — en-tête, chiffres clés,
 * montant en grand, état en pastille, confirmation en bouton or.
 *
 * Audit UI R1 (F01, F02, F06 ; PO-2026-09-27-05) — le signalement du client
 * n'est qu'un avis. Finance enregistre l'encaissement simulé à partir du
 * relevé fictif : référence bancaire simulée distincte de celle du client,
 * montant et date reçus. Une fois traité, l'écran montre le justificatif
 * fictif, l'état CDC §8.3 (« Rapproché (simulé) »), les affectations et le
 * montant non affecté. Dates au format unique, fuseau indiqué.
 */

const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const NOTICE_TONE: Record<PaymentNotice['status'], PillTone> = {
  declared: 'accent',
  confirmed: 'success',
  rejected: 'danger',
};

const fieldLabel = {
  display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600,
} as const;

// Audit UI R1 (F06) : format de date unique, fuseau indiqué.
function formatDate(iso: string) {
  return formatServerDateTime(iso);
}

function NoticeActions({ notice, onDone }: { notice: PaymentNotice; onDone: () => void }) {
  const api = useApiClient();
  const [bankReference, setBankReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(notice.paid_on);
  const [amount, setAmount] = useState(String(Number(notice.amount)));
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setPending(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, fallback));
      setPending(false);
    }
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    void run(() => api.confirmPaymentNotice(notice.id, notice.organization.id, {
      bank_reference: bankReference.trim(), received_on: receivedOn, amount: amount.trim(),
    }), 'Encaissement refusé.');
  }

  function reject(event: FormEvent) {
    event.preventDefault();
    void run(() => api.rejectPaymentNotice(notice.id, notice.organization.id, reason.trim()), 'Rejet refusé.');
  }

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px', paddingTop: '16px',
        borderTop: `1px solid ${semanticColors.neutral.border}`,
      }}
    >
      <form
        onSubmit={confirm}
        aria-label={`Enregistrer l'encaissement du virement ${notice.client_reference}`}
        style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <label style={{ ...fieldLabel, flex: '1 1 200px', maxWidth: '280px' }}>
          Référence bancaire simulée (relevé)
          <Input
            aria-label="Référence bancaire simulée"
            placeholder="ex. SIM-ENC-0003"
            value={bankReference}
            onChange={(event) => setBankReference(event.target.value)}
            required
            style={{ fontFamily: MONO }}
          />
        </label>
        <label style={{ ...fieldLabel, flex: '0 1 160px' }}>
          Montant reçu
          <Input
            aria-label="Montant reçu"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <label style={fieldLabel}>
          Reçu le
          <Input
            aria-label="Date de réception"
            type="date"
            value={receivedOn}
            onChange={(event) => setReceivedOn(event.target.value)}
          />
        </label>
        <Button type="submit" variant="accent" disabled={pending || bankReference.trim() === '' || amount.trim() === ''}>
          Enregistrer l’encaissement
        </Button>
      </form>
      <form
        onSubmit={reject}
        aria-label={`Rejeter le virement ${notice.client_reference}`}
        style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <label style={{ ...fieldLabel, flex: '1 1 260px', maxWidth: '420px' }}>
          Motif (virement introuvable au relevé)
          <Input
            aria-label="Motif du rejet"
            placeholder="Aucun virement correspondant au relevé du jour"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={pending || reason.trim() === ''}>Introuvable au relevé</Button>
      </form>
      {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

/** Justificatif bancaire FICTIF de l'encaissement : ce qui fait foi. */
function ReceiptProof({ receipt }: { receipt: PaymentNoticeReceipt }) {
  const unallocated = Number(receipt.unallocated_amount);
  return (
    <section
      aria-label={`Justificatif bancaire fictif ${receipt.bank_reference}`}
      data-testid="receipt-proof"
      style={{
        display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px', padding: '14px 16px',
        border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '8px', background: semanticColors.neutral.subtle,
      }}
    >
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>Justificatif bancaire fictif</strong>
        <Pill tone={receipt.status === 'reconciled_sim' ? 'success' : 'primary'} data-testid="receipt-status">{receipt.status_label}</Pill>
        <SimulatedMark detail="Encaissement" />
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 20px', margin: 0 }}>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Référence bancaire simulée</dt>
        <dd style={{ margin: 0, fontFamily: MONO }} data-testid="receipt-bank-reference">{receipt.bank_reference}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Montant reçu</dt>
        <dd style={{ margin: 0 }}>{formatAmount(receipt.amount, receipt.currency)}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Reçu le</dt>
        <dd style={{ margin: 0 }}>{formatCalendarDate(receipt.received_on)}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Enregistré par</dt>
        <dd style={{ margin: 0 }}>{`${receipt.recorded_by}, le ${formatServerDateTime(receipt.recorded_at)}`}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Affectations</dt>
        <dd style={{ margin: 0 }}>
          {receipt.allocations.length === 0 ? 'Aucune' : (
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {receipt.allocations.map((allocation) => (
                <li key={allocation.id}>{`${formatAmount(allocation.amount, receipt.currency)} → ${allocation.payment_call}`}</li>
              ))}
            </ul>
          )}
        </dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Non affecté</dt>
        <dd style={{ margin: 0, fontWeight: unallocated > 0 ? 700 : 400 }} data-testid="receipt-unallocated">
          {formatAmount(receipt.unallocated_amount, receipt.currency)}
        </dd>
      </dl>
    </section>
  );
}

function NoticeCard({ notice, canAct, onDone }: { notice: PaymentNotice; canAct: boolean; onDone: () => void }) {
  const callLabel = notice.payment_call.tier_label
    ? `${notice.payment_call.kind_label} — ${notice.payment_call.tier_label}`
    : notice.payment_call.kind_label;
  return (
    <Card
      title={`${notice.program.name} — ${notice.lot.name}`}
      icon="wallet"
      action={<Pill tone={NOTICE_TONE[notice.status]} data-testid="notice-status">{notice.status_label}</Pill>}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <span style={{ fontFamily: typography.headingFontFamily, fontSize: '30px', fontWeight: 600, color: semanticColors.neutral.heading }}>
          {formatAmount(notice.amount, notice.currency)}
        </span>
        <span style={{ color: semanticColors.neutral.textMuted }}>{`signalé pour : ${callLabel}`}</span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 20px', margin: 0 }}>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Client</dt>
        <dd style={{ margin: 0 }}>{notice.client.full_name ? `${notice.client.full_name} (${notice.client.email})` : notice.client.email}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Appel</dt>
        <dd style={{ margin: 0 }}>{`${callLabel} — ${formatAmount(notice.payment_call.amount)}`}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Montant signalé</dt>
        <dd style={{ margin: 0 }}>{formatAmount(notice.amount, notice.currency)}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Référence indiquée par le client</dt>
        <dd style={{ margin: 0, fontFamily: MONO }}>{notice.client_reference}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Virement du (selon le client)</dt>
        <dd style={{ margin: 0 }}>{formatCalendarDate(notice.paid_on)}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Signalé le</dt>
        <dd style={{ margin: 0 }}>{formatDate(notice.created_at)}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Réservation</dt>
        <dd style={{ margin: 0 }}>{notice.reservation.status_label}</dd>
        {notice.rejection_reason && (
          <>
            <dt style={{ color: semanticColors.neutral.textMuted }}>Motif du rejet</dt>
            <dd style={{ margin: 0 }}>{notice.rejection_reason}</dd>
          </>
        )}
      </dl>
      {notice.receipt && <ReceiptProof receipt={notice.receipt} />}
      {canAct && notice.status === 'declared' && <NoticeActions notice={notice} onDone={onDone} />}
    </Card>
  );
}

const RECEIVABLE_STATUSES: AdminReservation['status'][] = ['held', 'reserved', 'committed'];

/**
 * Audit UI R1 (PO-2026-09-27-19, CDC §8.1 : flux principal) — Finance
 * enregistre un encaissement simulé SANS signalement préalable du client :
 * choix du dossier, référence bancaire simulée obligatoire, montant et date
 * reçus, puis affectation à un ou plusieurs appels et rapprochement. Le
 * montant non affecté reste visible (T12) ; la réservation avance d'elle-même
 * (T03).
 */
function ReceiptEntry() {
  const api = useApiClient();
  const state = useApiResource(() => api.listReservations(), []);
  const [reservationId, setReservationId] = useState('');
  const [nonce, setNonce] = useState(0);
  const reservations = state.status === 'success'
    ? state.data.filter((reservation) => RECEIVABLE_STATUSES.includes(reservation.status)) : [];
  const selected = reservations.find((reservation) => reservation.id === reservationId);
  return (
    <Card title="Enregistrer un encaissement" icon="wallet" aria-label="Enregistrer un encaissement">
      <p style={{ margin: '0 0 12px', color: semanticColors.neutral.textMuted }}>
        Flux principal : un virement figure au relevé fictif, avec ou sans signalement du client. Choisissez le dossier,
        enregistrez l’encaissement, affectez-le à un ou plusieurs appels, puis rapprochez-le.
      </p>
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger les dossiers." onRetry={state.refetch} />
      )}
      <label style={{ ...fieldLabel, maxWidth: '520px' }}>
        Dossier
        <Select aria-label="Dossier de l’encaissement" value={reservationId} onChange={(event) => setReservationId(event.target.value)}>
          <option value="">Choisir un dossier…</option>
          {reservations.map((reservation) => (
            <option key={reservation.id} value={reservation.id}>
              {`${reservation.client.full_name || reservation.client.email} — ${reservation.lot.name} (${reservation.status_label})`}
            </option>
          ))}
        </Select>
      </label>
      {selected && (
        <div style={{ marginTop: '12px' }}>
          <FinancialFilePanel
            key={`${selected.id}-${nonce}`}
            reservation={selected}
            canIssueCalls={false}
            canRecordMovements
            onChanged={() => { state.refetch(); setNonce((value) => value + 1); }}
          />
        </div>
      )}
    </Card>
  );
}

export function PaymentNoticesView({ canAct }: { canAct: boolean }) {
  const api = useApiClient();
  const [filter, setFilter] = useState<'declared' | 'all'>('declared');
  const state = useApiResource(() => api.listPaymentNotices(filter), [filter]);
  const notices = state.status === 'success' ? state.data : [];
  const toConfirm = notices.filter((notice) => notice.status === 'declared');
  const toConfirmTotal = toConfirm.reduce((sum, notice) => sum + Number(notice.amount), 0);

  return (
    <section aria-label="Virements déclarés">
      <PageHeader
        eyebrow="Finance"
        title="Virements déclarés et encaissements"
        subtitle={canAct
          ? 'Enregistrez chaque virement du relevé fictif. Un signalement du client n’est pas un encaissement : cherchez-le au relevé, puis enregistrez-le ou indiquez qu’il est introuvable.'
          : 'Signalements des clients et encaissements enregistrés par Finance.'}
        actions={(
          <label style={fieldLabel}>
            Afficher
            <Select
              aria-label="Filtrer les virements"
              value={filter}
              onChange={(event) => setFilter(event.target.value as 'declared' | 'all')}
              style={{ width: '220px' }}
            >
              <option value="declared">À traiter</option>
              <option value="all">Tous</option>
            </Select>
          </label>
        )}
      />
      <SimulatedMark detail="Virements et encaissements" style={{ margin: '0 0 16px' }} />
      {canAct && <div style={{ marginBottom: '24px' }}><ReceiptEntry key={state.status === 'success' ? notices.length : 0} /></div>}
      <h2 style={{ fontSize: '20px', margin: '0 0 12px' }}>Virements signalés par les clients</h2>
      {state.status === 'success' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <KeyFigure label="Signalements à traiter" value={toConfirm.length} tone={toConfirm.length ? 'accent' : 'neutral'} data-testid="kf-to-confirm" />
          <KeyFigure label="Montant signalé, non encaissé" value={formatAmount(String(toConfirmTotal))} data-testid="kf-to-confirm-amount" />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {state.status === 'loading' && <p>Chargement…</p>}
        {state.status === 'error' && (
          <ApiErrorBanner error={state.error} title="Impossible de charger les virements." onRetry={state.refetch} />
        )}
        {state.status === 'success' && notices.length === 0 && <p>Aucun signalement à traiter.</p>}
        {notices.map((notice) => (
          <NoticeCard key={`${notice.id}-${notice.status}`} notice={notice} canAct={canAct} onDone={state.refetch} />
        ))}
      </div>
    </section>
  );
}
