/**
 * Tokens de couleur sémantique (ticket 008) — partagés indépendamment de
 * `AlertBanner`, sur le même principe que `densityTokens` (ticket 007) :
 * réutilisables par tout futur composant qui a besoin d'un traitement
 * "alerte" (ex : exceptions/blocages du Control Tower BUILD, ticket 009),
 * sans redéfinir sa propre palette. Volontairement séparés de
 * `StatusBadge/levelMeta.ts` : ces couleurs ne représentent aucun des 5
 * niveaux Visible Trust, seulement un registre visuel générique
 * (alerte/avertissement).
 */

export interface SemanticColorTokens {
  background: string;
  border: string;
  icon: string;
  text: string;
  /**
   * Ticket F-051 — mode sombre, `danger` UNIQUEMENT (jamais `alert`, aucun
   * bouton "alert" solide n'existe dans ce projet). `border`/`icon`
   * inversent volontairement de teinte entre thèmes (un rouge SOMBRE en
   * clair devient un rouge CLAIR en sombre, pour rester lisible en tant que
   * texte/icône SUR le fond `background` déjà sombre du bandeau d'alerte
   * lui-même) — ce même rouge clair, réutilisé comme REMPLISSAGE SOLIDE
   * d'un bouton (`Button` variante danger, texte blanc fixe), perdrait tout
   * contraste. `solid` reste donc DÉLIBÉRÉMENT figé, IDENTIQUE dans les
   * deux thèmes (voir `GlobalStyles.tsx`) — même principe que `brandColors`
   * (couleur d'accent fixe, jamais une surface qui s'inverse). Optionnel :
   * `alert` ne le définit pas, aucun composant n'en a besoin pour cette
   * palette.
   */
  solid?: string;
}

/**
 * Ticket 023 (polish visuel) — `neutral`/`progress` ajoutés : jusqu'ici
 * `#E5E7EB` (bordures) et `#34D399` (vert de progression) étaient dupliqués
 * en dur, indépendamment, dans `AppShell.tsx` et `OverviewView.tsx` (aucun
 * token neutre n'existait, seul `alert` était partagé) — même risque de
 * divergence silencieuse déjà documenté pour `LEVEL_PROGRESS_FRACTION`/
 * `OPEN_RESERVE_STATUSES` côté backend (CLAUDE.md, ticket 013), reproduit
 * ici côté frontend. `progress.fill` reprend la MÊME valeur que
 * `TrustLevel.verifie` (`#34D399`, `levelMeta.ts`) par simple coïncidence
 * de goût visuel — volontairement PAS le même token : une progression de
 * lot n'est pas un `TrustLevel` (même raisonnement que StatusBadge vs
 * AlertBanner, CLAUDE.md section Design system), les deux valeurs peuvent
 * diverger un jour sans lien de dépendance entre elles.
 */
export interface NeutralColorTokens {
  border: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
}

export interface ProgressColorTokens {
  track: string;
  fill: string;
}

/**
 * Ticket F-039 — identité de marque KEYIMMO AFRIC (navy/or), volontairement
 * SÉPARÉE de `semanticColors` : ce ne sont pas des couleurs sémantiques
 * génériques réutilisables par tout composant, mais la palette de marque,
 * dont la consommation est délibérément restreinte à HOME (l'écran client
 * final) — voir `F-039-identite-marque-home.md`. Les écrans professionnels
 * (BUILD, CONTROL, apps/web) n'y touchent jamais, cohérents avec la
 * doctrine 17.3 V3.0 (densité/vitesse de scan plutôt qu'identité visuelle).
 * Deux valeurs seulement, aucune nuance dérivée inventée sans besoin
 * démontré — ne jamais utiliser ce groupe pour dériver de nouvelles teintes
 * à la volée. Distincte de `levelMeta.ts` (TrustLevel, ticket 003/007),
 * seule autre exception "couleur de marque" du projet — les deux registres
 * ne se mélangent jamais.
 */
export interface BrandColorTokens {
  navy: string;
  gold: string;
}

export const brandColors: BrandColorTokens = {
  navy: '#0B1D3A',
  gold: '#C49A2C',
};

/**
 * Ticket F-051 — mode sombre. `semanticColors` référence désormais des
 * VARIABLES CSS (`var(--keya-*)`), jamais des hex littéraux directement :
 * les valeurs réelles (claires ET sombres) vivent dans `:root`/
 * `@media (prefers-color-scheme: dark)`/`[data-theme]` (voir
 * `GlobalStyles.tsx`, source UNIQUE des deux palettes). Chaque composant
 * qui consomme `semanticColors.X.Y` (dans un `style={{}}`, un template de
 * chaîne CSS, OU un attribut SVG `fill`/`stroke` — vérifié en navigateur
 * réel, Chromium, AVANT ce changement : `var()` s'y résout aussi bien
 * qu'en `style`) continue de fonctionner SANS AUCUNE modification, seule
 * la valeur RÉSOLUE change désormais selon le thème actif — zéro
 * changement requis dans Button/Input/Select/Card/AppShell/StatusBadge/
 * ProgressBar/AlertBanner/TabBar.
 *
 * `brandColors` (ci-dessus) reste des hex littéraux, INTOUCHÉ par ce
 * ticket — identité de marque FIXE par doctrine (voir sa propre
 * docstring), jamais dérivée du thème actif.
 */
export const semanticColors: {
  alert: SemanticColorTokens;
  danger: SemanticColorTokens;
  neutral: NeutralColorTokens;
  progress: ProgressColorTokens;
} = {
  alert: {
    background: 'var(--keya-alert-background)',
    border: 'var(--keya-alert-border)',
    icon: 'var(--keya-alert-icon)',
    text: 'var(--keya-alert-text)',
  },
  // Ticket F-038 — dédié EXCLUSIVEMENT à la confirmation d'une action
  // irréversible (ex : `Button` variante `danger`, désactivation de compte).
  // Jamais réutilisé pour une alerte non-bloquante (qui reste `alert`,
  // ambre) — catégorie sémantique différente, décision explicite de
  // l'utilisateur pour éviter toute confusion entre les deux. Valeurs
  // réelles (claire/sombre) et leur justification de contraste : voir
  // `GlobalStyles.tsx`, section `--keya-danger-*`.
  danger: {
    background: 'var(--keya-danger-background)',
    border: 'var(--keya-danger-border)',
    icon: 'var(--keya-danger-icon)',
    text: 'var(--keya-danger-text)',
    solid: 'var(--keya-danger-solid)',
  },
  neutral: {
    border: 'var(--keya-neutral-border)',
    background: 'var(--keya-neutral-background)',
    surface: 'var(--keya-neutral-surface)',
    text: 'var(--keya-neutral-text)',
    // Ticket 024 (audit accessibilité, valeur claire) — voir
    // `GlobalStyles.tsx` pour les deux valeurs réelles et leurs ratios de
    // contraste vérifiés (clair ET sombre).
    textMuted: 'var(--keya-neutral-text-muted)',
  },
  progress: {
    track: 'var(--keya-progress-track)',
    fill: 'var(--keya-progress-fill)',
  },
};
