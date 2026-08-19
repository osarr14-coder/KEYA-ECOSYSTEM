/**
 * Ticket 023 (polish visuel) — jusqu'ici, AUCUNE des 4 apps ne déclarait de
 * `font-family` nulle part (aucun fichier CSS n'existe dans ce monorepo,
 * uniquement des styles inline) : chaque écran retombait sur la police par
 * défaut du navigateur (souvent une serif), la source la plus visible
 * d'incohérence entre écrans. Une seule pile de police, posée une fois via
 * `GlobalStyles`, plutôt que redéfinie par app.
 */
export const typography = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};
