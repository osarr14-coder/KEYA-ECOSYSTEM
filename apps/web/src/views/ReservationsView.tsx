import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Card, Input, Select,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { AdminReservation, ReservationStatus } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { AdminContractPanel } from './AdminContractPanel';
import { FinancialFilePanel } from './FinancialFilePanel';

/**
 * Ticket F-067 — réservations côté équipe KEYIMMO (admin_keyimmo et
 * gestionnaire_adv), toutes organisations (backend B-048). Le statut est
 * celui du cycle de vente (CDC V3 §6.1), jamais un `TrustLevel` : texte
 * simple, pas `StatusBadge`.
 *
 * Ticket F-068 — Finance y accède aussi (lecture, backend B-051) pour
 * trouver les dossiers et y enregistrer les mouvements : `canManageSales`
 * (admin/ADV) garde l'annulation, le contrat et l'émission des appels ;
 * `canRecordMovements` (Finance) les encaissements. Les gardes réelles
 * restent côté serveur.
 */

export interface SalesPermissions {
  canManageSales: boolean;
  canRecordMovements: boolean;
}

const STATUS_OPTIONS: { value: ReservationStatus | ''; label: string }[] = [
  { value: 'held', label: 'Bloquées' },
  { value: 'reserved', label: 'Réservées' },
  { value: 'committed', label: 'Concrétisées' },
  { value: 'expired', label: 'Expirées' },
  { value: 'cancelled', label: 'Annulées' },
  { value: '', label: 'Toutes' },
];

// Même fuseau que HOME (ticket F-066) : scénario en Côte d'Ivoire.
function formatDateTime(iso: string) {
  const formatted = new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Abidjan',
  });
  return `${formatted} (heure d'Abidjan, GMT)`;
}

function formatAmount(value: string, currency: string) {
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`;
}

function CancelForm({ reservation, onCancelled }: { reservation: AdminReservation; onCancelled: () => void }) {
  const api = useApiClient();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.cancelReservation(reservation.id, reservation.organization.id, reason.trim());
      onCancelled();
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, "Échec de l'annulation."));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label={`Annuler la réservation ${reservation.lot.name}`}
      style={{
        display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '8px',
      }}
    >
      <label>
        Motif d&apos;annulation
        <Input
          type="text"
          aria-label="Motif d'annulation"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          style={{ marginTop: '4px', width: '320px' }}
        />
      </label>
      <Button type="submit" variant="secondary" disabled={submitting || reason.trim() === ''}>
        {submitting ? 'Annulation…' : 'Annuler la réservation'}
      </Button>
      {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

/**
 * Ticket F-071 (backend B-056) — l'ADV (ou l'admin) valide le dossier ;
 * l'appel « Frais » part au client dans la même opération. Refuser le
 * dossier = l'annuler avec un motif (formulaire ci-dessous).
 */
function ValidateButton({ reservation, onValidated }: { reservation: AdminReservation; onValidated: () => void }) {
  const api = useApiClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function validate() {
    setPending(true);
    setError(null);
    try {
      await api.validateReservation(reservation.id, reservation.organization.id);
      onValidated();
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, 'Validation refusée.'));
      setPending(false);
    }
  }

  return (
    <div style={{ marginTop: '8px' }}>
      <Button type="button" onClick={() => { void validate(); }} disabled={pending}>
        {pending ? 'Validation…' : 'Valider la réservation et appeler les frais'}
      </Button>
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </div>
  );
}

function ReservationCard({
  reservation, onChanged, permissions,
}: { reservation: AdminReservation; onChanged: () => void; permissions: SalesPermissions }) {
  return (
    <Card title={`${reservation.program.name} — ${reservation.lot.name}`} icon="building">
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0 }}>
        <dt>Statut</dt>
        <dd style={{ margin: 0 }} data-testid="reservation-status">{reservation.status_label}</dd>
        <dt>Client</dt>
        <dd style={{ margin: 0 }}>
          {reservation.client.full_name
            ? `${reservation.client.full_name} (${reservation.client.email})`
            : reservation.client.email}
        </dd>
        <dt>Organisation</dt>
        <dd style={{ margin: 0 }}>{reservation.organization.name}</dd>
        <dt>Prix figé</dt>
        <dd style={{ margin: 0 }}>{formatAmount(reservation.price_amount, reservation.currency)}</dd>
        {reservation.status === 'held' && (
          <>
            <dt>Blocage jusqu&apos;au</dt>
            <dd style={{ margin: 0 }}>{formatDateTime(reservation.held_until)}</dd>
          </>
        )}
        <dt>Validation ADV</dt>
        <dd style={{ margin: 0 }} data-testid="reservation-validation">
          {reservation.validated_at
            ? `Validée${reservation.validated_by ? ` par ${reservation.validated_by}` : ''} le ${formatDateTime(reservation.validated_at)}`
            : 'En attente de validation'}
        </dd>
        {reservation.status === 'cancelled' && (
          <>
            <dt>Annulée par</dt>
            <dd style={{ margin: 0 }}>{reservation.cancelled_by ?? '—'}</dd>
            <dt>Motif</dt>
            <dd style={{ margin: 0 }}>{reservation.cancellation_reason || '—'}</dd>
          </>
        )}
      </dl>
      {permissions.canManageSales && reservation.status === 'held' && !reservation.validated_at && (
        <ValidateButton reservation={reservation} onValidated={onChanged} />
      )}
      {permissions.canManageSales && reservation.status === 'held' && (
        <CancelForm reservation={reservation} onCancelled={onChanged} />
      )}
      {/* Ticket F-067 (partie 2) — contrat, historique compris même après
          expiration ou annulation (lecture seule dans ce cas). */}
      {permissions.canManageSales && <AdminContractPanel reservation={reservation} />}
      <FinancialFilePanel
        reservation={reservation}
        canIssueCalls={permissions.canManageSales}
        canRecordMovements={permissions.canRecordMovements}
        onChanged={onChanged}
      />
    </Card>
  );
}

const DEFAULT_PERMISSIONS: SalesPermissions = { canManageSales: true, canRecordMovements: false };

export function ReservationsView({ permissions = DEFAULT_PERMISSIONS }: { permissions?: SalesPermissions }) {
  const api = useApiClient();
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | ''>('held');
  const state = useApiResource(() => api.listReservations(statusFilter || undefined), [statusFilter]);

  return (
    <section aria-label="Réservations">
      <h2>Réservations</h2>
      <label>
        Statut
        <Select
          aria-label="Filtrer par statut"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ReservationStatus | '')}
          style={{ marginTop: '4px', width: '220px' }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
        {state.status === 'loading' && <p>Chargement…</p>}
        {state.status === 'error' && (
          <ApiErrorBanner error={state.error} title="Impossible de charger les réservations." onRetry={state.refetch} />
        )}
        {state.status === 'success' && state.data.length === 0 && <p>Aucune réservation dans cet état.</p>}
        {state.status === 'success' && state.data.map((reservation) => (
          <ReservationCard
            key={reservation.id}
            reservation={reservation}
            onChanged={state.refetch}
            permissions={permissions}
          />
        ))}
      </div>
    </section>
  );
}
