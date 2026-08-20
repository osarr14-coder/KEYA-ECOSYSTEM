import { StatusDot } from './StatusDot';
import type { SyncStatus } from '../db/types';

/**
 * Indicateur de statut de synchronisation par item — PAS StatusBadge du
 * design system (ticket 007) : `pending/syncing/synced/conflict` n'est pas
 * un des 5 niveaux Visible Trust, réutiliser StatusBadge ici laisserait
 * croire, à tort, qu'un statut de synchronisation EST un niveau de
 * confiance (même raisonnement qu'AlertBanner vs StatusBadge, ticket 008).
 * Local à cette app pour l'instant — pas encore promu au design system,
 * aucun second consommateur ne l'a réclamé (contrairement à AlertBanner).
 *
 * Ticket 023 (polish visuel) — une pastille colorée complète le texte
 * (jamais la couleur SEULE, principe déjà respecté ailleurs dans ce
 * projet, ticket 014) ; couleurs choisies volontairement DIFFÉRENTES des 5
 * teintes `TrustLevel` (`packages/design-system/.../levelMeta.ts`) pour ne
 * jamais laisser croire, même par ressemblance visuelle, qu'un statut de
 * synchronisation serait un niveau de confiance.
 *
 * Ticket F-033 (vague 4) — le rendu pastille+libellé est désormais délégué
 * à `StatusDot`, extrait au moment où `PhotoSyncStatusIndicator` en devient
 * un second consommateur réel avec la même forme mais un domaine de
 * valeurs distinct (`MediaSyncStatus`) — comportement observable inchangé
 * (mêmes `data-testid`/`data-status`/libellés).
 */
const LABELS: Record<SyncStatus, string> = {
  pending: 'En attente de synchronisation',
  syncing: 'Synchronisation en cours',
  synced: 'Synchronisé',
  conflict: 'Conflit à résoudre',
};

const DOT_COLOR: Record<SyncStatus, string> = {
  pending: '#9CA3AF',
  syncing: '#2563EB',
  synced: '#16A34A',
  conflict: '#DC2626',
};

export function SyncStatusIndicator({ status }: { status: SyncStatus }) {
  return (
    <StatusDot testId="sync-status" status={status} label={LABELS[status]} color={DOT_COLOR[status]} />
  );
}
