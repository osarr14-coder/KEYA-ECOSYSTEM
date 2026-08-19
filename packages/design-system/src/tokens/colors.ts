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

export const semanticColors: {
  alert: SemanticColorTokens;
  neutral: NeutralColorTokens;
  progress: ProgressColorTokens;
} = {
  alert: {
    background: '#FFFBEB',
    border: '#D97706',
    icon: '#D97706',
    text: '#92400E',
  },
  neutral: {
    border: '#E5E7EB',
    background: '#F9FAFB',
    surface: '#FFFFFF',
    text: '#111827',
    // Ticket 024 (audit accessibilité) — `#6B7280` sur fond blanc mesurait
    // 4,83:1, au-dessus du minimum WCAG AA texte normal (4,5:1) mais avec
    // une marge trop faible (~7 %) pour un ton utilisé partout comme texte
    // secondaire (dates, sous-titres, libellés muets). `#4B5563` porte ce
    // ratio à ~7,5:1 (niveau AAA), sans changement de teinte perceptible.
    textMuted: '#4B5563',
  },
  progress: {
    track: '#E5E7EB',
    fill: '#34D399',
  },
};
