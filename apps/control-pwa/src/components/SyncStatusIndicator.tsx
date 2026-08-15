import type { SyncStatus } from '../db/types';

/**
 * Indicateur de statut de synchronisation par item — PAS StatusBadge du
 * design system (ticket 007) : `pending/syncing/synced/conflict` n'est pas
 * un des 5 niveaux Visible Trust, réutiliser StatusBadge ici laisserait
 * croire, à tort, qu'un statut de synchronisation EST un niveau de
 * confiance (même raisonnement qu'AlertBanner vs StatusBadge, ticket 008).
 * Local à cette app pour l'instant — pas encore promu au design system,
 * aucun second consommateur ne l'a réclamé (contrairement à AlertBanner).
 */
const LABELS: Record<SyncStatus, string> = {
  pending: 'En attente de synchronisation',
  syncing: 'Synchronisation en cours',
  synced: 'Synchronisé',
  conflict: 'Conflit à résoudre',
};

export function SyncStatusIndicator({ status }: { status: SyncStatus }) {
  return <span data-testid="sync-status" data-status={status}>{LABELS[status]}</span>;
}
