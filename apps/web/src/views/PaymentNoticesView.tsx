import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Card, DateInput, EmptyState, Input, KeyFigure, Money, PageHeader, Pill, type PillTone, ReceiptProof,
  Reference, Select, SimulatedMark, Skeleton, TabBar, formatCalendarDate, formatMoney, formatServerDateTime, semanticColors,
  typography,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type {
  AdminReservation, FinanceReceipt, PaymentNotice, PaymentNoticeReceipt,
} from '../api/types';
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
 *
 * PO-2026-09-28-01, -02, -10, -11 — menu « Encaissements », deux vues :
 * encaissements enregistrés (relevé fictif) et « Signalements clients ».
 * Un signalement se RATTACHE à un encaissement déjà enregistré (référence
 * affichée), s'enregistre depuis le relevé (montant reçu vide par défaut :
 * il se lit au relevé), ou se CLÔTURE sans rattachement avec un motif
 * obligatoire. Tout est tracé côté serveur.
 */

const MONO = typography.monoFontFamily;

const NOTICE_TONE: Record<PaymentNotice['status'], PillTone> = {
  declared: 'alert',
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
  const candidates = notice.attachable_receipts ?? [];
  const [receiptId, setReceiptId] = useState(candidates[0]?.id ?? '');
  const [bankReference, setBankReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(notice.paid_on);
  // PO-2026-09-28-10 : vide par défaut — le montant se lit au relevé.
  const [amount, setAmount] = useState('');
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

  function attach(event: FormEvent) {
    event.preventDefault();
    void run(() => api.attachPaymentNotice(notice.id, notice.organization.id, receiptId), 'Rattachement refusé.');
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    void run(() => api.confirmPaymentNotice(notice.id, notice.organization.id, {
      bank_reference: bankReference.trim(), received_on: receivedOn, amount: amount.trim(),
    }), 'Encaissement refusé.');
  }

  function reject(event: FormEvent) {
    event.preventDefault();
    void run(() => api.rejectPaymentNotice(notice.id, notice.organization.id, reason.trim()), 'Clôture refusée.');
  }

  const sectionTitle = { margin: 0, fontSize: '15px', fontWeight: 700 } as const;
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: '18px', marginTop: '16px', paddingTop: '16px',
        borderTop: `1px solid ${semanticColors.neutral.border}`,
      }}
    >
      <form
        onSubmit={attach}
        aria-label={`Rattacher le signalement ${notice.client_reference} à un encaissement`}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        <h3 style={sectionTitle}>Rattacher à un encaissement déjà enregistré</h3>
        {candidates.length === 0 ? (
          <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>
            Aucun encaissement enregistré sur ce dossier. Enregistrez-le ci-dessous s’il figure au relevé.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ ...fieldLabel, flex: '1 1 260px', maxWidth: '440px' }}>
              Encaissement
              <Select aria-label="Encaissement à rattacher" value={receiptId} onChange={(event) => setReceiptId(event.target.value)}>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {`${candidate.bank_reference} — ${formatMoney(candidate.amount, candidate.currency)} — reçu le ${formatCalendarDate(candidate.received_on)}`}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="secondary" disabled={pending || receiptId === ''}>Rattacher</Button>
          </div>
        )}
      </form>
      <form
        onSubmit={confirm}
        aria-label={`Enregistrer l'encaissement du virement ${notice.client_reference}`}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        <h3 style={sectionTitle}>Enregistrer l’encaissement depuis le relevé</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
            Montant reçu (relevé)
            <Input
              aria-label="Montant reçu"
              inputMode="numeric"
              placeholder="Lu au relevé"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <div style={fieldLabel}>
            <span>Reçu le</span>
            <DateInput label="Date de réception" value={receivedOn} onChange={setReceivedOn} />
          </div>
          <Button type="submit" variant="accent" disabled={pending || bankReference.trim() === '' || amount.trim() === ''}>
            Enregistrer l’encaissement
          </Button>
        </div>
      </form>
      <form
        onSubmit={reject}
        aria-label={`Clôturer le signalement ${notice.client_reference} sans rattachement`}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        <h3 style={sectionTitle}>Clôturer sans rattachement</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ ...fieldLabel, flex: '1 1 260px', maxWidth: '420px' }}>
            Motif (obligatoire)
            <Input
              aria-label="Motif de clôture"
              placeholder="Aucun virement correspondant au relevé du jour"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <Button type="submit" variant="secondary" disabled={pending || reason.trim() === ''}>Clôturer sans rattachement</Button>
        </div>
      </form>
      {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

/** Justificatif bancaire FICTIF de l'encaissement : ce qui fait foi. */
function ReceiptProofBlock({ receipt }: { receipt: PaymentNoticeReceipt }) {
  // PO-2026-09-27-20 (DESIGN_SYSTEM §10) : justificatif unique du design system.
  return (
    <div style={{ marginTop: '16px' }}>
      <ReceiptProof
        bankReference={receipt.bank_reference}
        amount={receipt.amount}
        currency={receipt.currency}
        receivedOn={receipt.received_on}
        recordedBy={receipt.recorded_by}
        recordedAt={receipt.recorded_at}
        statusLabel={receipt.status_label}
        reconciled={receipt.status === 'reconciled_sim'}
        allocations={receipt.allocations.map((allocation) => ({
          id: allocation.id, label: allocation.payment_call, amount: allocation.amount,
        }))}
        unallocatedAmount={receipt.unallocated_amount}
      />
    </div>
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
        <span style={{ fontSize: '24px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: semanticColors.neutral.heading }}>
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
        {notice.receipt && (
          <>
            <dt style={{ color: semanticColors.neutral.textMuted }}>Rattaché à l’encaissement</dt>
            <dd style={{ margin: 0 }} data-testid="notice-receipt-reference">
              <Reference value={notice.receipt.bank_reference} label="Référence de l’encaissement" />
            </dd>
          </>
        )}
        {notice.rejection_reason && (
          <>
            <dt style={{ color: semanticColors.neutral.textMuted }}>Motif de clôture</dt>
            <dd style={{ margin: 0 }}>{notice.rejection_reason}</dd>
          </>
        )}
      </dl>
      {notice.receipt && <ReceiptProofBlock receipt={notice.receipt} />}
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

/** PO-2026-09-28-01 — relevé des encaissements enregistrés (Finance). */
function ReceiptsLedger() {
  const api = useApiClient();
  const state = useApiResource(() => api.listReceipts(), []);
  if (state.status === 'loading') return <Skeleton lines={4} label="Chargement des encaissements" />;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger les encaissements." onRetry={state.refetch} />;
  }
  if (state.data.length === 0) {
    return <EmptyState message="Aucun encaissement enregistré. Enregistrez le premier depuis le relevé fictif, ci-dessus." />;
  }
  const receipts: FinanceReceipt[] = state.data;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table aria-label="Encaissements enregistrés">
        <thead>
          <tr>
            <th>Reçu le</th>
            <th>Référence (relevé)</th>
            <th>Dossier</th>
            <th style={{ textAlign: 'right' }}>Montant</th>
            <th style={{ textAlign: 'right' }}>Non affecté</th>
            <th>État</th>
            <th>Signalement rattaché</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((receipt) => (
            <tr key={receipt.id} data-testid="ledger-receipt">
              <td style={{ whiteSpace: 'nowrap' }}>{formatCalendarDate(receipt.received_on)}</td>
              <td><Reference value={receipt.bank_reference} label="Référence bancaire simulée" /></td>
              <td>
                {`${receipt.client.full_name || receipt.client.email} — ${receipt.lot.name}`}
                <span style={{ display: 'block', fontSize: '13px', color: semanticColors.neutral.textMuted }}>{receipt.program.name}</span>
              </td>
              <td style={{ textAlign: 'right' }}><Money value={receipt.amount} currency={receipt.currency} kind="received" /></td>
              <td style={{ textAlign: 'right' }}><Money value={receipt.unallocated_amount} currency={receipt.currency} kind="unallocated" /></td>
              <td><Pill tone={receipt.status === 'reconciled_sim' ? 'success' : 'info'}>{receipt.status_label}</Pill></td>
              <td>
                {receipt.notices.length === 0 ? '—' : receipt.notices.map((linked) => (
                  <span key={linked.id} style={{ display: 'block' }}>
                    <Reference value={linked.client_reference} label="Référence indiquée par le client" copyable={false} />
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientSignals({ canAct }: { canAct: boolean }) {
  const api = useApiClient();
  const [filter, setFilter] = useState<'declared' | 'all'>('declared');
  const state = useApiResource(() => api.listPaymentNotices(filter), [filter]);
  const notices = state.status === 'success' ? state.data : [];
  const toConfirm = notices.filter((notice) => notice.status === 'declared');
  const toConfirmTotal = toConfirm.reduce((sum, notice) => sum + Number(notice.amount), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={{ margin: 0, color: semanticColors.neutral.textMuted, maxWidth: '72ch' }}>
        Un signalement du client n’est pas un encaissement. Rattachez-le à l’encaissement enregistré depuis le relevé, ou
        clôturez-le sans rattachement avec un motif.
      </p>
      <label style={{ ...fieldLabel, maxWidth: '240px' }}>
        Afficher
        <Select
          aria-label="Filtrer les virements"
          value={filter}
          onChange={(event) => setFilter(event.target.value as 'declared' | 'all')}
        >
          <option value="declared">À traiter</option>
          <option value="all">Tous</option>
        </Select>
      </label>
      {state.status === 'success' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <KeyFigure label="Signalements à traiter" value={toConfirm.length} tone={toConfirm.length ? 'accent' : 'neutral'} data-testid="kf-to-confirm" />
          <KeyFigure label="Montant signalé, non encaissé" value={formatAmount(String(toConfirmTotal))} data-testid="kf-to-confirm-amount" />
        </div>
      )}
      {state.status === 'loading' && <Skeleton lines={3} label="Chargement des signalements" />}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger les virements." onRetry={state.refetch} />
      )}
      {state.status === 'success' && notices.length === 0 && <p>Aucun signalement à traiter.</p>}
      {notices.map((notice) => (
        <NoticeCard key={`${notice.id}-${notice.status}`} notice={notice} canAct={canAct} onDone={state.refetch} />
      ))}
    </div>
  );
}

export function PaymentNoticesView({ canAct }: { canAct: boolean }) {
  const [view, setView] = useState<'receipts' | 'signals'>('receipts');
  return (
    <section aria-label="Encaissements">
      <PageHeader
        title="Encaissements"
        subtitle="Enregistrez chaque virement du relevé fictif, puis traitez les signalements des clients."
      />
      <SimulatedMark detail="Virements et encaissements" style={{ margin: '0 0 16px' }} />
      <TabBar
        aria-label="Vues des encaissements"
        tabs={[
          { id: 'receipts', label: 'Encaissements enregistrés', icon: 'receipt' },
          { id: 'signals', label: 'Signalements clients', icon: 'bell' },
        ]}
        activeTabId={view}
        onChange={(id) => setView(id as 'receipts' | 'signals')}
      />
      <div style={{ marginTop: '20px' }}>
        {view === 'receipts' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {canAct && <ReceiptEntry />}
            <div>
              <h2 style={{ fontSize: '20px', margin: '0 0 12px' }}>Relevé des encaissements enregistrés</h2>
              <ReceiptsLedger />
            </div>
          </div>
        ) : (
          <ClientSignals canAct={canAct} />
        )}
      </div>
    </section>
  );
}
