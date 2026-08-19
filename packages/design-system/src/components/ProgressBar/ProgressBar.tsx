import { semanticColors } from '../../tokens/colors';

/**
 * Ticket 023 (polish visuel) — extrait de `apps/home/src/views/
 * OverviewView.tsx` (ticket 008), qui affichait une vraie barre colorée,
 * alors qu'`apps/build/src/views/AllLotsView.tsx` (ticket 009) affichait la
 * MÊME donnée (`progress_percentage`, calculée côté backend,
 * `apps/home/services.py`/`apps/build/services.py`) comme un simple texte
 * `"42%"` — deux présentations pour une donnée identique, sans raison
 * fonctionnelle. Composant purement présentationnel : reçoit un
 * pourcentage déjà calculé, n'en dérive ni n'en recalcule jamais aucun
 * (même discipline « aucun calcul frontend » que le reste du projet,
 * CLAUDE.md).
 */
export interface ProgressBarProps {
  /** Pourcentage déjà calculé côté backend — jamais recalculé ici. */
  percentage: number;
  /** Largeur de la piste — `200px` en usage "hero" (HOME), plus étroite en
   * cellule de tableau dense (BUILD). */
  width?: string;
  'aria-label'?: string;
}

export function ProgressBar({ percentage, width = '100%', 'aria-label': ariaLabel }: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      data-testid="progress-bar"
      style={{
        background: semanticColors.progress.track,
        borderRadius: 999,
        overflow: 'hidden',
        height: 8,
        width,
      }}
    >
      <div
        data-testid="progress-bar-fill"
        style={{ width: `${percentage}%`, background: semanticColors.progress.fill, height: '100%' }}
      />
    </div>
  );
}
