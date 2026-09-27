import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Card,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { CatalogLot, Reservation, ReservationStatus } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { ClientContractPanel } from './ClientContractPanel';
import { ClientPaymentCallsPanel } from './ClientPaymentCallsPanel';

/**
 * Ticket F-066 — parcours d'achat du client (CDC V3 §9.2, étapes 1-2) :
 * catalogue des lots publiés, demande de réservation, suivi du blocage.
 * Backend B-048 : la disponibilité et le refus en cas de concurrence (T01)
 * sont décidés par le serveur, jamais recalculés ici.
 */

const ACTIVE_STATUSES: ReservationStatus[] = ['held', 'reserved', 'committed'];

// CDC V3 §5 : « l'interface indique son fuseau ». Scénario en Côte
// d'Ivoire : heure d'Abidjan (GMT, sans heure d'été).
const DISPLAY_TIME_ZONE = 'Africa/Abidjan';

export function formatAmount(value: string, currency: string) {
  const amount = Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  return `${amount} ${currency}`;
}

export function formatDateTime(iso: string) {
  const formatted = new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: DISPLAY_TIME_ZONE,
  });
  return `${formatted} (heure d'Abidjan, GMT)`;
}

function errorDetail(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && caught.body && typeof caught.body === 'object' && 'detail' in caught.body) {
    return String((caught.body as { detail: unknown }).detail);
  }
  return fallback;
}

function nextStep(reservation: Reservation) {
  switch (reservation.status) {
    case 'held':
      // Ticket F-071 (backend B-056) — le conseiller KEYIMMO (ADV) valide
      // d'abord le dossier, puis le client règle les frais par virement.
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

function ReservationRow({ reservation, onChanged }: { reservation: Reservation; onChanged: () => void }) {
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
    <li data-testid="reservation" style={{ padding: '12px 0', borderBottom: '1px solid var(--keya-border, #E5E7EB)' }}>
      <strong>{reservation.program.name} — {reservation.lot.name}</strong>
      {' · '}
      <span data-testid="reservation-status">{reservation.status_label}</span>
      {' · '}
      {formatAmount(reservation.price_amount, reservation.currency)}
      <p style={{ margin: '4px 0 0' }}>{nextStep(reservation)}</p>
      {/* Ticket F-066 (partie 2) — contrat, tant que la réservation vit. */}
      {ACTIVE_STATUSES.includes(reservation.status) && <ClientContractPanel reservationId={reservation.id} />}
      {/* Ticket F-068 — appels de fonds et leur couverture. */}
      {ACTIVE_STATUSES.includes(reservation.status) && <ClientPaymentCallsPanel reservationId={reservation.id} />}
      {reservation.status === 'held' && !confirming && (
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)} style={{ marginTop: '8px' }}>
          Annuler cette réservation
        </Button>
      )}
      {reservation.status === 'held' && confirming && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
          <Button type="button" onClick={() => { void cancel(); }} disabled={submitting}>
            {submitting ? 'Annulation…' : "Confirmer l'annulation"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
            Garder la réservation
          </Button>
        </div>
      )}
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </li>
  );
}

function CatalogLotCard({ lot, onReserved }: { lot: CatalogLot; onReserved: () => void }) {
  const api = useApiClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reserve() {
    setSubmitting(true);
    setError(null);
    try {
      await api.requestReservation(lot.id, lot.organization.id);
      onReserved();
    } catch (caught) {
      setError(errorDetail(caught, 'La réservation a échoué. Réessayez.'));
      setSubmitting(false);
    }
  }

  return (
    <li data-testid="catalog-lot" style={{ padding: '12px 0', borderBottom: '1px solid var(--keya-border, #E5E7EB)' }}>
      <strong>{lot.program.name} — {lot.name}</strong>
      <p style={{ margin: '4px 0' }}>
        {lot.asset.name}
        {lot.asset.location ? ` · ${lot.asset.location}` : ''}
        {lot.surface ? ` · ${lot.surface} m²` : ''}
        {' · '}
        <strong>{formatAmount(lot.sale_price, lot.currency)}</strong>
      </p>
      <p style={{ margin: '0 0 8px', fontSize: '13px' }}>Programme porté par {lot.organization.name}</p>
      <Button type="button" onClick={() => { void reserve(); }} disabled={submitting}>
        {submitting ? 'Réservation…' : 'Réserver ce bien'}
      </Button>
      {error && (
        <div style={{ marginTop: '8px' }}>
          <AlertBanner title={error} />
        </div>
      )}
    </li>
  );
}

export function ClientSalesView() {
  const api = useApiClient();
  const reservationsState = useApiResource(() => api.getMyReservations(), []);
  const catalogState = useApiResource(() => api.getCatalogLots(), []);

  function refreshAll() {
    reservationsState.refetch();
    catalogState.refetch();
  }

  return (
    <section aria-label="Acheter un bien" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2 style={{ margin: 0 }}>Acheter un bien</h2>

      <Card title="Mes réservations" icon="clipboard-check">
        {reservationsState.status === 'loading' && <p>Chargement…</p>}
        {reservationsState.status === 'error' && (
          <ApiErrorBanner
            error={reservationsState.error}
            title="Impossible de charger vos réservations."
            onRetry={reservationsState.refetch}
          />
        )}
        {reservationsState.status === 'success' && reservationsState.data.length === 0 && (
          <p>Vous n&apos;avez encore réservé aucun bien.</p>
        )}
        {reservationsState.status === 'success' && reservationsState.data.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {reservationsState.data.map((reservation) => (
              <ReservationRow key={reservation.id} reservation={reservation} onChanged={refreshAll} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Biens disponibles" icon="building">
        {catalogState.status === 'loading' && <p>Chargement…</p>}
        {catalogState.status === 'error' && (
          <ApiErrorBanner error={catalogState.error} title="Impossible de charger le catalogue." onRetry={catalogState.refetch} />
        )}
        {catalogState.status === 'success' && catalogState.data.length === 0 && (
          <p>Aucun bien n&apos;est disponible à la réservation pour le moment.</p>
        )}
        {catalogState.status === 'success' && catalogState.data.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {catalogState.data.map((lot) => (
              <CatalogLotCard key={lot.id} lot={lot} onReserved={refreshAll} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
