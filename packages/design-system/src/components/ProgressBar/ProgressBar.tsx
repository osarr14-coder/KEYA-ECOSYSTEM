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
 *
 * Ticket 024 (audit accessibilite) - la piste (progress.track) sur fond de
 * page blanc mesurait environ 1,2:1, tres en dessous du minimum WCAG 1.4.11
 * (contraste non textuel, 3:1 requis pour la frontiere d'un composant
 * d'interface) ; le remplissage (progress.fill) contre la piste mesurait
 * environ 1,55:1, egalement insuffisant. Une bordure explicite definit
 * desormais la frontiere du composant independamment du fond de page qui
 * l'entoure. Severite limitee en pratique : le pourcentage exact reste
 * TOUJOURS affiche en texte a cote (OverviewView/AllLotsView), jamais porte
 * par la seule barre, qui reste decorative/complementaire.
 */
export interface ProgressBarProps {
  /** Pourcentage déjà calculé côté backend — jamais recalculé ici. */
  percentage: number;
  /** Largeur de la piste — `200px` en usage "hero" (HOME), plus étroite en
   * cellule de tableau dense (BUILD). */
  width?: string;
  /**
   * Ticket F-046 — override générique du remplissage, défaut
   * `semanticColors.progress.fill` (vert) inchangé partout où cette prop
   * n'est pas fournie. Composant lui-même reste neutre de marque : la
   * couleur de marque (doctrine 17.3, réservée à HOME) est fournie par
   * l'appelant, jamais codée en dur ici — même principe que le `style`
   * passthrough de `Button`.
   */
  fillColor?: string;
  'aria-label'?: string;
}

export function ProgressBar({
  percentage, width = '100%', fillColor = semanticColors.progress.fill, 'aria-label': ariaLabel,
}: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${percentage} %`}
      aria-label={ariaLabel}
      data-testid="progress-bar"
      style={{
        background: semanticColors.progress.track,
        border: `1px solid ${semanticColors.neutral.textMuted}`,
        borderRadius: 999,
        overflow: 'hidden',
        height: 8,
        width,
      }}
    >
      <div
        data-testid="progress-bar-fill"
        style={{ width: `${percentage}%`, background: fillColor, height: '100%' }}
      />
    </div>
  );
}
