import { ARCHIVE_MARKING } from '../../copy/demoCopy';
import { semanticColors } from '../../tokens/colors';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §7, CDC §3.1, T14) : bandeau
 * supplémentaire d'une instance archivée, sous le bandeau de démonstration,
 * même grammaire hachurée (forme, pas couleur de statut). Les actions de
 * l'instance restent visibles mais désactivées, avec explication.
 */
export function ArchiveBanner({ instanceCode }: { instanceCode?: string }) {
  return (
    <div
      role="note"
      data-testid="archive-banner"
      aria-label={`${ARCHIVE_MARKING}${instanceCode ? `, instance ${instanceCode}` : ''}`}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: '10px',
        padding: '4px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 800, letterSpacing: '0.06em',
        color: semanticColors.neutral.heading,
        borderBottom: `1px solid ${semanticColors.neutral.heading}`,
        background: `repeating-linear-gradient(45deg, transparent 0 8px, rgba(128, 128, 128, 0.18) 8px 16px), ${semanticColors.neutral.subtle}`,
      }}
    >
      <span aria-hidden="true">{ARCHIVE_MARKING}</span>
      <span aria-hidden="true" style={{ fontWeight: 600, letterSpacing: 0 }}>
        Aucune action n’est possible sur une instance archivée.
      </span>
    </div>
  );
}
