import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Card, PageHeader, Pill, formatSurface, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { CatalogLot, Reservation, ReservationStatus } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { formatAmount, formatDateTime } from '../format';
import { AcquisitionJourney, reservationMessage, reservationTone } from './AcquisitionJourney';

/**
 * Ticket F-066 — parcours d'achat du client (CDC V3 §9.2, étapes 1-2) :
 * catalogue des lots publiés, demande de réservation, suivi du blocage.
 * Backend B-048 : la disponibilité et le refus en cas de concurrence (T01)
 * sont décidés par le serveur, jamais recalculés ici.
 *
 * Ticket F-074 (direction « Confiance premium ») — « Mon acquisition » :
 * chaque réservation active devient un parcours guidé (`AcquisitionJourney`),
 * le catalogue une grille de cartes, les réservations closes un historique.
 */

// Réexportés pour compatibilité (tests F-066) — source unique : `format.ts`.
export { formatAmount, formatDateTime };

const ACTIVE_STATUSES: ReservationStatus[] = ['held', 'reserved', 'committed'];

function errorDetail(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && caught.body && typeof caught.body === 'object' && 'detail' in caught.body) {
    return String((caught.body as { detail: unknown }).detail);
  }
  return fallback;
}

function PastReservationRow({ reservation }: { reservation: Reservation }) {
  return (
    <li
      data-testid="reservation"
      style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '14px 0', borderBottom: `1px solid ${semanticColors.neutral.border}` }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
        <strong>{reservation.program.name} — {reservation.lot.name}</strong>
        <Pill tone={reservationTone(reservation)} data-testid="reservation-status">{reservation.status_label}</Pill>
        <span style={{ color: semanticColors.neutral.textMuted }}>{formatAmount(reservation.price_amount, reservation.currency)}</span>
      </div>
      <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>{reservationMessage(reservation)}</p>
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
    <li
      data-testid="catalog-lot"
      style={{
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '6px',
        overflow: 'hidden',
        background: semanticColors.neutral.surface,
      }}
    >
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
        <strong style={{ fontSize: '17px', fontWeight: 700, color: semanticColors.neutral.heading }}>
          {lot.program.name} — {lot.name}
        </strong>
        <span style={{ color: semanticColors.neutral.textMuted }}>
          {lot.asset.name}
          {lot.asset.location ? ` · ${lot.asset.location}` : ''}
          {lot.surface ? ` · ${formatSurface(lot.surface)}` : ''}
        </span>
        <span style={{ fontSize: '20px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: semanticColors.neutral.heading }}>
          {formatAmount(lot.sale_price, lot.currency)}
        </span>
        <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>{`Programme lancé par KEYIMMO AFRIC · constructeur : ${lot.organization.name}`}</span>
        <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
          <Button type="button" onClick={() => { void reserve(); }} disabled={submitting} style={{ width: '100%' }}>
            {submitting ? 'Réservation…' : 'Réserver ce bien'}
          </Button>
        </div>
        {error && <AlertBanner title={error} />}
      </div>
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

  const reservations = reservationsState.status === 'success' ? reservationsState.data : [];
  const active = reservations.filter((reservation) => ACTIVE_STATUSES.includes(reservation.status));
  const past = reservations.filter((reservation) => !ACTIVE_STATUSES.includes(reservation.status));

  return (
    <section aria-label="Mon acquisition" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <PageHeader
        title="Mon acquisition"
        subtitle={active.length > 0
          ? 'Suivez chaque étape de votre achat : une seule action vous est demandée à la fois.'
          : 'Choisissez un bien disponible : il est bloqué pour vous pendant l’examen de votre dossier.'}
      />

      {reservationsState.status === 'loading' && <p>Chargement…</p>}
      {reservationsState.status === 'error' && (
        <ApiErrorBanner
          error={reservationsState.error}
          title="Impossible de charger vos réservations."
          onRetry={reservationsState.refetch}
        />
      )}
      {reservationsState.status === 'success' && reservations.length === 0 && (
        <Card>
          <p style={{ margin: 0 }}>Vous n&apos;avez encore réservé aucun bien.</p>
        </Card>
      )}

      {active.map((reservation) => (
        <AcquisitionJourney key={reservation.id} reservation={reservation} onChanged={refreshAll} />
      ))}

      <Card title="Biens disponibles" icon="building">
        {catalogState.status === 'loading' && <p>Chargement…</p>}
        {catalogState.status === 'error' && (
          <ApiErrorBanner error={catalogState.error} title="Impossible de charger le catalogue." onRetry={catalogState.refetch} />
        )}
        {catalogState.status === 'success' && catalogState.data.length === 0 && (
          <p style={{ margin: 0 }}>Aucun bien n&apos;est disponible à la réservation pour le moment.</p>
        )}
        {catalogState.status === 'success' && catalogState.data.length > 0 && (
          <ul
            style={{
              margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px',
            }}
          >
            {catalogState.data.map((lot) => (
              <CatalogLotCard key={lot.id} lot={lot} onReserved={refreshAll} />
            ))}
          </ul>
        )}
      </Card>

      {past.length > 0 && (
        <Card title="Historique" icon="clipboard-check" aria-label="Réservations closes">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {past.map((reservation) => <PastReservationRow key={reservation.id} reservation={reservation} />)}
          </ul>
        </Card>
      )}
    </section>
  );
}
