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

export const semanticColors: { alert: SemanticColorTokens } = {
  alert: {
    background: '#FFFBEB',
    border: '#D97706',
    icon: '#D97706',
    text: '#92400E',
  },
};
