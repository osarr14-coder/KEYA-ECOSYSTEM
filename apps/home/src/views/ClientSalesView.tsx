import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Card, PageHeader, Pill, formatSurface, semanticColors,
  LotPlan, hasLotPlan,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { CatalogLot, Reservation, ReservationStatus } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { formatAmount, formatDateTime } from '../format';
import {
  AcquisitionJourney, reservationEndMessage, reservationMessage, reservationTone,
} from './AcquisitionJourney';

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

/**
 * PO-2026-09-28-43 (P28, CDC §6.1) — la dernière réservation du client a pris
 * fin (annulation ou expiration) : il le lit en tête de « Mon acquisition »,
 * daté, attribué et motivé, avant le catalogue. Couleur d'attention, jamais
 * le rouge réservé aux erreurs (PO-2026-09-28-17).
 */
function ReservationEndedNotice({ reservation }: { reservation: Reservation }) {
  return (
    <section
      role="status"
      aria-label="Fin de votre réservation"
      data-testid="reservation-ended"
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 18px', borderRadius: '6px',
        background: semanticColors.alert.background, border: `1px solid ${semanticColors.alert.border}`,
        color: semanticColors.alert.text,
      }}
    >
      <strong>
        {reservation.status === 'expired' ? 'Votre blocage a expiré' : 'Votre réservation a été annulée'}
        {` — ${reservation.program.name} / ${reservation.lot.name}`}
      </strong>
      <p style={{ margin: 0 }}>{reservationEndMessage(reservation)}</p>
    </section>
  );
}

function CatalogLotCard({
  lot, onReserved, onRefused,
}: { lot: CatalogLot; onReserved: () => void; onRefused: (message: string) => void }) {
  const api = useApiClient();
  const [submitting, setSubmitting] = useState(false);

  async function reserve() {
    setSubmitting(true);
    try {
      await api.requestReservation(lot.id, lot.organization.id);
      onReserved();
    } catch (caught) {
      // PO-2026-09-28-43 (P29) : le refus (bien pris entre-temps, T01) est
      // affiché au-dessus du catalogue, qui se recharge aussitôt : la carte
      // d'un bien devenu indisponible disparaît, le motif reste lisible.
      onRefused(errorDetail(caught, 'La réservation a échoué. Réessayez.'));
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
      {/* PO-2026-09-28-26 : vignette du plan (plein écran, zoom tactile) ;
          rien pour un lot sans plan (A2). */}
      {hasLotPlan(lot.program.name, lot.name) && (
        <div style={{ padding: '14px 14px 0' }}>
          <LotPlan programName={lot.program.name} lotName={lot.name} />
        </div>
      )}
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
      </div>
    </li>
  );
}

export function ClientSalesView() {
  const api = useApiClient();
  const reservationsState = useApiResource(() => api.getMyReservations(), []);
  const catalogState = useApiResource(() => api.getCatalogLots(), []);

  const [refusal, setRefusal] = useState<{ lot: string; message: string } | null>(null);

  function refreshAll() {
    setRefusal(null);
    reservationsState.refetch();
    catalogState.refetch();
  }

  function refused(lot: CatalogLot, message: string) {
    refreshAll();
    setRefusal({ lot: `${lot.program.name} — ${lot.name}`, message });
  }

  const reservations = reservationsState.status === 'success' ? reservationsState.data : [];
  const active = reservations.filter((reservation) => ACTIVE_STATUSES.includes(reservation.status));
  const past = reservations.filter((reservation) => !ACTIVE_STATUSES.includes(reservation.status));
  // Liste triée par le serveur, la plus récente d'abord.
  const ended = reservations.length > 0 && !ACTIVE_STATUSES.includes(reservations[0].status) ? reservations[0] : null;

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

      {ended && <ReservationEndedNotice reservation={ended} />}

      {active.map((reservation) => (
        <AcquisitionJourney key={reservation.id} reservation={reservation} onChanged={refreshAll} />
      ))}

      <Card title="Biens disponibles" icon="building">
        {refusal && <AlertBanner title={refusal.message}>{`Bien demandé : ${refusal.lot}.`}</AlertBanner>}
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
              <CatalogLotCard
                key={lot.id} lot={lot} onReserved={refreshAll} onRefused={(message) => refused(lot, message)}
              />
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
