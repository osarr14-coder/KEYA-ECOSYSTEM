import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Card, Icon, Input, KeyFigure, PageHeader, Pill, type PillTone, Select, semanticColors, formatServerDateTime,
  MilestoneGauge, Timeline,
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
  { value: 'held', label: 'Biens bloqués' },
  { value: 'reserved', label: 'Réservées' },
  { value: 'committed', label: 'Concrétisées' },
  { value: 'expired', label: 'Expirées' },
  { value: 'cancelled', label: 'Annulées' },
  { value: '', label: 'Toutes' },
];

// Même fuseau que HOME (ticket F-066) : scénario en Côte d'Ivoire.
// Audit UI R1 (F06) : format de date unique, fuseau indiqué.
function formatDateTime(iso: string) {
  return formatServerDateTime(iso);
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
        display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600, flex: '1 1 260px', maxWidth: '420px' }}>
        Refuser le dossier — motif d&apos;annulation
        <Input
          type="text"
          aria-label="Motif d'annulation"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
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
      setError(formatDrfFieldErrors(caught, 'Appel des frais refusé.'));
      setPending(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="accent" onClick={() => { void validate(); }} disabled={pending}>
        {pending ? 'Envoi…' : 'Dossier examiné : appeler les frais de réservation'}
      </Button>
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </div>
  );
}

function initials(reservation: AdminReservation) {
  const source = reservation.client.full_name;
  return source.split(/[\s.()]+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');
}

function clientLabel(reservation: AdminReservation) {
  return reservation.client.full_name;
}

export function reservationTone(status: ReservationStatus): PillTone {
  switch (status) {
    case 'committed': return 'success';
    case 'reserved': return 'info';
    case 'held': return 'alert';
    case 'cancelled': return 'danger';
    default: return 'neutral';
  }
}

/**
 * Ticket F-075 (direction « Confiance premium ») — fiche dossier : l'essentiel
 * d'un dossier client en un écran (identité, chiffres clés, prochaine action,
 * contrat, paiements). Les panneaux Contrat et Dossier financier sont
 * inchangés : seules leur mise en page et la hiérarchie évoluent.
 */
function ReservationDossier({
  reservation, onChanged, onBack, permissions, mode,
}: {
  reservation: AdminReservation;
  onChanged: () => void;
  onBack: () => void;
  permissions: SalesPermissions;
  mode: ReservationsMode;
}) {
  const needsValidation = reservation.status === 'held' && !reservation.validated_at;
  return (
    <article aria-label={`Dossier — ${clientLabel(reservation)}, ${reservation.lot.name}`} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <Button type="button" variant="secondary" onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          {mode === 'finance' ? 'Appels par dossier' : 'Dossiers clients'}
        </Button>
      </div>

      <header style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <span
          aria-hidden="true"
          style={{
            width: '56px', height: '56px', flexShrink: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', background: semanticColors.primary.background, color: semanticColors.primary.text,
            fontWeight: 700, fontSize: '18px',
          }}
        >
          {initials(reservation)}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 320px', minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '28px' }}>{`${clientLabel(reservation)} · ${reservation.lot.name}`}</h2>
          <span style={{ color: semanticColors.neutral.textMuted }}>
            {[
              reservation.program.name,
              reservation.lot.surface ? `${Number(reservation.lot.surface).toLocaleString('fr-FR')} m²` : null,
            ].filter(Boolean).join(' · ')}
          </span>
        </div>
        <Pill tone={reservationTone(reservation.status)} data-testid="reservation-status">{reservation.status_label}</Pill>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <KeyFigure label="Prix à la réservation (fictif)" value={formatAmount(reservation.price_amount, reservation.currency)} />
        <KeyFigure label="Organisation" textual value={reservation.organization.name} />
        {reservation.status === 'held' && (
          // PO-2026-09-28-57 : échéance suspendue expliquée au gestionnaire.
          <KeyFigure
            label={reservation.hold_suspension ? 'Échéance du blocage' : "Blocage jusqu'au"}
            textual
            value={reservation.hold_suspension === 'notice_declared'
              ? 'Suspendue : virement signalé, vérification Finance'
              : reservation.hold_suspension === 'receipt'
                ? 'Suspendue : encaissement enregistré, revue Finance'
                : formatDateTime(reservation.held_until)}
            tone="accent"
          />
        )}
        {/* Audit UI R1 (J07) : le gestionnaire EXAMINE le dossier puis
            appelle les frais ; KEYIMMO ne « valide » rien. */}
        <KeyFigure
          label="Examen du dossier"
          textual
          tone={reservation.validated_at ? 'success' : needsValidation ? 'alert' : 'neutral'}
          value={(
            <span data-testid="reservation-validation">
              {reservation.validated_at
                ? `Examiné${reservation.validated_by ? ` par ${reservation.validated_by}` : ''} le ${formatDateTime(reservation.validated_at)}`
                : 'Examen en attente'}
            </span>
          )}
        />
      </div>

      {reservation.status === 'cancelled' && (
        <Card title="Annulation" icon="alert-triangle">
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
            <dt>Annulée par</dt>
            <dd style={{ margin: 0 }}>{reservation.cancelled_by ?? '—'}</dd>
            <dt>Motif</dt>
            <dd style={{ margin: 0 }}>{reservation.cancellation_reason || '—'}</dd>
          </dl>
        </Card>
      )}

      {permissions.canManageSales && reservation.status === 'held' && (
        <section
          aria-label="Prochaine action"
          style={{
            border: `1px solid ${needsValidation ? semanticColors.neutral.heading : semanticColors.neutral.border}`,
            borderRadius: '6px',
            background: semanticColors.neutral.surface,
            padding: 'clamp(16px, 3vw, 24px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 600, color: semanticColors.neutral.textMuted }}>
            Prochaine action
          </span>
          <h3 style={{ margin: 0, fontSize: '20px' }}>
            {needsValidation ? 'Examiner le dossier et appeler les frais de réservation' : 'Suivre le paiement des frais de réservation'}
          </h3>
          <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>
            {needsValidation
              ? 'Une fois le dossier examiné, l’appel des frais part au client avec ses instructions de virement (simulé).'
              : 'Le client a reçu l’appel des frais. Finance enregistre l’encaissement simulé quand il figure au relevé fictif.'}
          </p>
          {needsValidation && <ValidateButton reservation={reservation} onValidated={onChanged} />}
          <CancelForm reservation={reservation} onCancelled={onChanged} />
        </section>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          <Card title="Paiements" icon="wallet">
            <FinancialFilePanel
              reservation={reservation}
              canIssueCalls={permissions.canManageSales}
              canRecordMovements={permissions.canRecordMovements}
              onChanged={onChanged}
            />
            {!['held', 'reserved', 'committed'].includes(reservation.status) && (
              <p style={{ margin: 0 }}>Dossier clos : aucun mouvement possible.</p>
            )}
          </Card>
        </div>
        {/* Ticket F-067 (partie 2) — contrat, historique compris même après
            expiration ou annulation (lecture seule dans ce cas). */}
        {permissions.canManageSales && (
          <div style={{ flex: '1 1 380px', minWidth: 0 }}>
            <Card title="Contrat" icon="file-text">
              <AdminContractPanel reservation={reservation} />
            </Card>
          </div>
        )}
      </div>
      {permissions.canManageSales && mode !== 'finance' && <DossierChronologyCard reservationId={reservation.id} />}
    </article>
  );
}

/** Lot 4 (PO-2026-09-28-67, P12, P17 en partie) — chronologie du dossier et
 * du chantier de son lot, reconstruite par le serveur (journal des actes,
 * chaîne chantier, affectations de contrôle), en lecture seule. */
function DossierChronologyCard({ reservationId }: { reservationId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getDossierChronology(reservationId), [reservationId]);
  return (
    <Card title="Chronologie" icon="history">
      {state.status === 'loading' && <p style={{ margin: 0 }}>Chargement de la chronologie…</p>}
      {state.status === 'error' && <ApiErrorBanner error={state.error} title="Impossible de charger la chronologie." />}
      {state.status === 'success' && (
        <Timeline
          aria-label="Chronologie du dossier"
          emptyText="Aucun événement enregistré pour ce dossier."
          entries={state.data.entries.map((entry) => ({
            id: entry.id,
            actor: entry.actor,
            role: entry.role,
            action: entry.action,
            at: entry.at,
            justification: entry.justification || undefined,
            object: entry.object ? { label: entry.object } : undefined,
          }))}
        />
      )}
    </Card>
  );
}

function ReservationRow({ reservation, onOpen }: { reservation: AdminReservation; onOpen: () => void }) {
  return (
    <tr data-testid="reservation-row">
      <td>
        {/* PO-2026-09-28-34 / -40 : « Awa Koné · Cliente fictive » (rôle du jeu de démo). */}
        <div>
          <strong>{clientLabel(reservation)}</strong>
          <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>{` · ${reservation.client.role}`}</span>
        </div>
      </td>
      <td>
        <div style={{ fontWeight: 600 }}>{reservation.lot.name}</div>
        <div style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>{reservation.program.name}</div>
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatAmount(reservation.price_amount, reservation.currency)}</td>
      <td>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <Pill tone={reservationTone(reservation.status)}>{reservation.status_label}</Pill>
          {reservation.status === 'held' && !reservation.validated_at && <Pill tone="alert">À examiner</Pill>}
        </div>
      </td>
      {/* PO-2026-09-28-27 : jauge compacte du chantier (états CDC du serveur),
          compteur « n / N » en texte, prochaine étape et qui agit. */}
      <td>
        {reservation.worksite && reservation.worksite.milestones.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <MilestoneGauge
              variant="compact"
              aria-label={`Jalons — ${reservation.lot.name}`}
              milestones={reservation.worksite.milestones.map((item) => ({
                id: `${reservation.id}-${item.code}`, label: item.label, cdcState: item.cdc_state,
                statusLabel: item.status_label, openReserveCount: item.open_reserve_count,
              }))}
            />
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              {reservation.worksite.accepted_milestone_count}
              <span style={{ color: semanticColors.neutral.textMuted, fontWeight: 600 }}>{` / ${reservation.worksite.milestone_count}`}</span>
            </span>
          </div>
        ) : null}
        {reservation.worksite && reservation.worksite.open_reserve_count > 0 && (
          <div style={{ marginTop: '6px' }}>
            <Pill tone="alert">
              {`${reservation.worksite.open_reserve_count} réserve${reservation.worksite.open_reserve_count > 1 ? 's' : ''} ouverte${reservation.worksite.open_reserve_count > 1 ? 's' : ''}`}
            </Pill>
          </div>
        )}
      </td>
      <td>{reservation.worksite?.next_step ?? ''}</td>
      <td>{reservation.worksite?.next_actor ?? ''}</td>
      <td style={{ textAlign: 'right' }}>
        <Button type="button" variant="secondary" onClick={onOpen} aria-label={`Ouvrir le dossier ${clientLabel(reservation)} — ${reservation.lot.name}`}>
          Ouvrir
        </Button>
      </td>
    </tr>
  );
}

const DEFAULT_PERMISSIONS: SalesPermissions = { canManageSales: true, canRecordMovements: false };

/**
 * Audit UI R1 (R03, PO-2026-09-27-10) — `finance` : vue en LECTURE SEULE
 * « Appels par dossier » (PO-2026-09-28-12) (identité fictive, appels, encaissements,
 * affectations), sans gestion des dossiers, réservations ou contrats.
 */
export type ReservationsMode = 'sales' | 'finance';

export function ReservationsView({
  permissions = DEFAULT_PERMISSIONS, openReservationId, mode = 'sales',
}: { permissions?: SalesPermissions; openReservationId?: string | null; mode?: ReservationsMode }) {
  const api = useApiClient();
  // Ticket F-075 — ouvert depuis « À faire » sur un dossier précis : tous
  // statuts confondus, le dossier peut ne plus être « bloqué ».
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | ''>(openReservationId || mode === 'finance' ? '' : 'held');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(openReservationId ?? null);
  const state = useApiResource(() => api.listReservations(statusFilter || undefined), [statusFilter]);

  const all = state.status === 'success' ? state.data : [];
  const selected = selectedId ? all.find((reservation) => reservation.id === selectedId) : undefined;
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? all.filter((reservation) => [
      reservation.client.full_name, reservation.lot.name, reservation.program.name,
    ].some((value) => value.toLowerCase().includes(needle)))
    : all;

  if (selected) {
    return (
      <ReservationDossier
        reservation={selected}
        onChanged={state.refetch}
        onBack={() => setSelectedId(null)}
        permissions={permissions}
        mode={mode}
      />
    );
  }

  return (
    <section aria-label="Réservations" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {mode === 'finance' ? (
        <PageHeader
          eyebrow="Lecture seule — Finance"
          title="Appels par dossier"
          subtitle="Par dossier : appels de fonds, encaissements simulés et leurs affectations. Les encaissements s’enregistrent depuis « Encaissements »."
        />
      ) : (
        <PageHeader
          title="Dossiers clients"
          subtitle="Chaque réservation est un dossier : examen, contrat, appels de fonds et encaissements."
        />
      )}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600 }}>
          Statut
          <Select
            aria-label="Filtrer par statut"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ReservationStatus | '')}
            style={{ width: '220px' }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600, flex: '1 1 240px', maxWidth: '420px' }}>
          Rechercher
          <Input
            type="search"
            aria-label="Rechercher un dossier"
            placeholder="Client, lot, programme…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger les réservations." onRetry={state.refetch} />
      )}
      {state.status === 'success' && all.length === 0 && <p>Aucune réservation dans cet état.</p>}
      {state.status === 'success' && all.length > 0 && rows.length === 0 && <p>Aucun dossier ne correspond à la recherche.</p>}
      {rows.length > 0 && (
        <Card>
          {/* PO-2026-09-28-27 : colonnes de jauge ; le tableau défile dans sa carte. */}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Lot</th>
                  <th style={{ textAlign: 'right' }}>Prix à la réservation</th>
                  <th>État</th>
                  <th>Jalons</th>
                  <th>Prochaine étape</th>
                  <th>Qui agit</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((reservation) => (
                  <ReservationRow key={reservation.id} reservation={reservation} onOpen={() => setSelectedId(reservation.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}
