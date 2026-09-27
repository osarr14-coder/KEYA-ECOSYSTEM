import { ApiErrorBanner } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { ClientPaymentCall } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-068 — appels de fonds du client (backend B-050/B-051, CDC V3
 * §8.1) : montant appelé et état de couverture, tels que calculés par le
 * serveur. Un appel n'est « couvert » qu'une fois l'encaissement rapproché
 * par Finance ; un versement partiel ne le solde pas. Aucun paiement ne se
 * fait ici : les encaissements sont simulés et enregistrés par Finance.
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
      <ul style={{ margin: 0, paddingLeft: '20px' }}>
        {state.data.map((call) => (
          <li key={call.id} data-testid="payment-call">
            {call.tier_label ? `${call.kind_label} — ${call.tier_label}` : call.kind_label}
            {` : ${formatAmount(call.amount, call.currency)} · `}
            {call.settlement ? SETTLEMENT_LABELS[call.settlement] : '—'}
            {call.settlement === 'partial' && ` (${formatAmount(call.settled_amount, call.currency)} reçus)`}
          </li>
        ))}
      </ul>
    </section>
  );
}
