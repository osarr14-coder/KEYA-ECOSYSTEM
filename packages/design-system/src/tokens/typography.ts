/**
 * Ticket 023 (polish visuel) — jusqu'ici, AUCUNE des 4 apps ne déclarait de
 * `font-family` nulle part (aucun fichier CSS n'existe dans ce monorepo,
 * uniquement des styles inline) : chaque écran retombait sur la police par
 * défaut du navigateur (souvent une serif), la source la plus visible
 * d'incohérence entre écrans. Une seule pile de police, posée une fois via
 * `GlobalStyles`, plutôt que redéfinie par app.
 *
 * Ticket F-053 (refonte visuelle professionnelle) — `fontFamily` (corps de
 * texte/interface) passe de la pile système générique à `Public Sans`,
 * chargée via Google Fonts (voir `GlobalStyles.tsx`). `headingFontFamily`
 * (nouveau) : `Source Serif 4`, réservée aux titres (`h1`-`h3`, voir la
 * règle CSS dans `GlobalStyles.tsx`) — jamais fusionnée avec `fontFamily`,
 * une police d'interface ne doit jamais dériver silencieusement du choix
 * éditorial des titres, et un composant qui a besoin du corps de texte
 * (boutons, champs, tableaux) ne doit jamais hériter de la serif par
 * accident.
 */
export const typography = {
  fontFamily:
    "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  headingFontFamily:
    "'Source Serif 4', Georgia, 'Times New Roman', serif",
};
