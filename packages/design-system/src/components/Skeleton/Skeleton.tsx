import { semanticColors } from '../../tokens/colors';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §12) : chargement par squelettes sobres
 * aux dimensions du contenu — jamais de spinner plein écran, aucune
 * animation (pas de pulsation).
 */
export interface SkeletonProps {
  lines?: number;
  label?: string;
}

export function Skeleton({ lines = 3, label = 'Chargement' }: SkeletonProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-testid="skeleton" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <span style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{`${label}…`}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{
            display: 'block', height: '12px', borderRadius: '4px', background: semanticColors.neutral.subtle,
            border: `1px solid ${semanticColors.neutral.border}`, width: index === lines - 1 ? '60%' : '100%',
          }}
        />
      ))}
    </div>
  );
}
