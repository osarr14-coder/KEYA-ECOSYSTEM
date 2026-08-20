import { StatusDot } from './StatusDot';
import type { MediaSyncStatus } from '../db/types';

/**
 * Ticket F-033 (vague 4) — `LocalPhoto.mediaSyncStatus` était tracké en
 * données depuis le ticket 010 (passe 2) mais jamais lu par
 * `PhotoThumbnail` : une photo bloquée en échec d'upload restait
 * visuellement identique à une photo déjà synchronisée, sans le moindre
 * signal, même après plusieurs tentatives automatiques.
 *
 * PAS `SyncStatusIndicator` (celui du brouillon entier) : domaine de
 * valeurs distinct (`MediaSyncStatus` a `failed`, pas `conflict` — aucune
 * notion de conflit ne s'applique à un simple upload de fichier, voir
 * `db/types.ts`). Même forme visuelle (pastille + libellé, jamais la
 * couleur seule), déléguée au même `StatusDot` partagé.
 *
 * `failed` reste réessayé AUTOMATIQUEMENT par le moteur de synchro
 * (backoff exponentiel, jamais un abandon — voir `sync/backoff.ts`) :
 * contrairement au bandeau d'échec d'enregistrement local (portillon
 * `persistError`, action explicite requise), aucune action de
 * l'inspecteur n'est nécessaire ici — le libellé le dit explicitement
 * plutôt que de laisser croire à un blocage définitif.
 */
const LABELS: Record<MediaSyncStatus, string> = {
  pending: "En attente d'envoi",
  syncing: 'Envoi en cours',
  synced: 'Envoyée',
  failed: "Échec d'envoi — nouvelle tentative automatique",
};

const DOT_COLOR: Record<MediaSyncStatus, string> = {
  pending: '#9CA3AF',
  syncing: '#2563EB',
  synced: '#16A34A',
  failed: '#DC2626',
};

export function PhotoSyncStatusIndicator({ status }: { status: MediaSyncStatus }) {
  return (
    <StatusDot testId="photo-sync-status" status={status} label={LABELS[status]} color={DOT_COLOR[status]} />
  );
}
