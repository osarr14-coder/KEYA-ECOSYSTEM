import { ARCHIVE_MARKING } from '../../copy/demoCopy';
import { formatServerDateTime } from '../../format/dates';
import { semanticColors } from '../../tokens/colors';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §7, CDC §3.1, T14) : bandeau
 * supplémentaire d'une instance archivée, sous le bandeau de démonstration,
 * même grammaire hachurée (forme, pas couleur de statut). Les actions de
 * l'instance restent visibles mais désactivées, avec explication.
 *
 * Lot 5 (PO-2026-09-29-01) : identité de l'archive consultée (code, date
 * d'archivage) et retour à l'instance active quand `onReturn` est fourni.
 */
export interface ArchiveBannerProps {
  instanceCode?: string;
  archivedAt?: string | null;
  onReturn?: () => void;
}

export function ArchiveBanner({ instanceCode, archivedAt, onReturn }: ArchiveBannerProps) {
  const identity = [
    instanceCode ? `Instance ${instanceCode}` : null,
    archivedAt ? `archivée le ${formatServerDateTime(archivedAt)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div
      role="note"
      data-testid="archive-banner"
      aria-label={`${ARCHIVE_MARKING}${instanceCode ? `, instance ${instanceCode}` : ''}`}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: '10px', rowGap: '4px',
        padding: '4px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 800, letterSpacing: '0.06em',
        color: semanticColors.neutral.heading,
        borderBottom: `1px solid ${semanticColors.neutral.heading}`,
        background: `repeating-linear-gradient(45deg, transparent 0 8px, rgba(128, 128, 128, 0.18) 8px 16px), ${semanticColors.neutral.subtle}`,
      }}
    >
      <span aria-hidden="true">{ARCHIVE_MARKING}</span>
      {identity && (
        <span data-testid="archive-banner-identity" style={{ fontWeight: 600, letterSpacing: 0 }}>{identity}</span>
      )}
      <span aria-hidden="true" style={{ fontWeight: 600, letterSpacing: 0 }}>
        Aucune action n’est possible sur une instance archivée.
      </span>
      {onReturn && (
        <button
          type="button"
          className="keya-btn"
          onClick={onReturn}
          style={{
            font: 'inherit', fontWeight: 700, letterSpacing: 0, padding: '2px 10px', borderRadius: '4px', cursor: 'pointer',
            color: semanticColors.neutral.heading, background: semanticColors.neutral.surface,
            border: `1px solid ${semanticColors.neutral.heading}`,
          }}
        >
          Revenir à l’instance active
        </button>
      )}
    </div>
  );
}
