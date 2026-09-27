import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Card, Input, KeyFigure, PageHeader, Pill, type PillTone, Select, semanticColors, typography,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { PaymentNotice } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { SIMULATION_NOTICE, formatAmount } from './FinancialFilePanel';

/**
 * Ticket F-071 (backend B-056) — virements déclarés par les clients.
 * Finance vérifie le relevé bancaire (simulé) puis CONFIRME (encaissement
 * créé, affecté à l'appel, rapproché : la réservation avance d'elle-même,
 * l'ADV et le client sont notifiés) ou REJETTE avec un motif. L'ADV et
 * l'admin lisent. Une déclaration du client n'est jamais une preuve.
 *
 * Ticket F-078 (direction « Confiance premium ») — en-tête, chiffres clés,
 * montant en grand, état en pastille, confirmation en bouton or.
 */

const NOTICE_TONE: Record<PaymentNotice['status'], PillTone> = {
  declared: 'accent',
  confirmed: 'success',
  rejected: 'danger',
};

const fieldLabel = {
  display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600,
} as const;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Abidjan' });
}

function NoticeActions({ notice, onDone }: { notice: PaymentNotice; onDone: () => void }) {
  const api = useApiClient();
  const [bankReference, setBankReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(notice.paid_on);
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
      bank_reference: bankReference.trim(), received_on: receivedOn,
    }), 'Confirmation refusée.');
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
        aria-label={`Confirmer le virement ${notice.client_reference}`}
        style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <label style={{ ...fieldLabel, flex: '1 1 200px', maxWidth: '280px' }}>
          Référence sur le relevé (si différente)
          <Input
            aria-label="Référence sur le relevé"
            placeholder={notice.client_reference}
            value={bankReference}
            onChange={(event) => setBankReference(event.target.value)}
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
        <Button type="submit" variant="accent" disabled={pending}>Confirmer la réception</Button>
      </form>
      <form
        onSubmit={reject}
        aria-label={`Rejeter le virement ${notice.client_reference}`}
        style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <label style={{ ...fieldLabel, flex: '1 1 260px', maxWidth: '420px' }}>
          Motif du rejet
          <Input
            aria-label="Motif du rejet"
            placeholder="Virement introuvable sur le relevé"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={pending || reason.trim() === ''}>Rejeter</Button>
      </form>
      {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
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
        <span style={{ fontFamily: typography.headingFontFamily, fontSize: '30px', fontWeight: 600, color: semanticColors.neutral.heading }}>
          {formatAmount(notice.amount, notice.currency)}
        </span>
        <span style={{ color: semanticColors.neutral.textMuted }}>{`déclaré pour : ${callLabel}`}</span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 20px', margin: 0 }}>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Client</dt>
        <dd style={{ margin: 0 }}>{notice.client.full_name ? `${notice.client.full_name} (${notice.client.email})` : notice.client.email}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Appel</dt>
        <dd style={{ margin: 0 }}>{`${callLabel} — ${formatAmount(notice.payment_call.amount)}`}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Montant déclaré</dt>
        <dd style={{ margin: 0 }}>{formatAmount(notice.amount, notice.currency)}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Référence du client</dt>
        <dd style={{ margin: 0 }}>{notice.client_reference}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Virement du</dt>
        <dd style={{ margin: 0 }}>{notice.paid_on}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Déclaré le</dt>
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
      {canAct && notice.status === 'declared' && <NoticeActions notice={notice} onDone={onDone} />}
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
        eyebrow="Ventes · Finance"
        title="Virements déclarés"
        subtitle={canAct
          ? 'Vérifiez chaque virement sur le relevé, puis confirmez-le ou rejetez-le avec un motif. La réservation avance d’elle-même.'
          : 'Déclarations des clients, confirmées ou rejetées par Finance.'}
        actions={(
          <label style={fieldLabel}>
            Afficher
            <Select
              aria-label="Filtrer les virements"
              value={filter}
              onChange={(event) => setFilter(event.target.value as 'declared' | 'all')}
              style={{ width: '220px' }}
            >
              <option value="declared">À confirmer</option>
              <option value="all">Tous</option>
            </Select>
          </label>
        )}
      />
      <p style={{
        margin: '0 0 16px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', color: semanticColors.accent.text,
      }}
      >
        {SIMULATION_NOTICE}
      </p>
      {state.status === 'success' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <KeyFigure label="À confirmer" value={toConfirm.length} tone={toConfirm.length ? 'accent' : 'neutral'} data-testid="kf-to-confirm" />
          <KeyFigure label="Montant à vérifier" value={formatAmount(String(toConfirmTotal))} data-testid="kf-to-confirm-amount" />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {state.status === 'loading' && <p>Chargement…</p>}
        {state.status === 'error' && (
          <ApiErrorBanner error={state.error} title="Impossible de charger les virements." onRetry={state.refetch} />
        )}
        {state.status === 'success' && notices.length === 0 && <p>Aucun virement à confirmer.</p>}
        {notices.map((notice) => (
          <NoticeCard key={`${notice.id}-${notice.status}`} notice={notice} canAct={canAct} onDone={state.refetch} />
        ))}
      </div>
    </section>
  );
}
