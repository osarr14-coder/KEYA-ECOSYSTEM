/**
 * Tokens de densité (ticket 007) — deux jeux de valeurs partagés, pas propres
 * à AppShell : tout futur composant de liste/tableau (ticket 009, Control
 * Tower BUILD) doit consommer `densityTokens[density]` plutôt que définir ses
 * propres espacements. "dense" sert les écrans professionnels à fort volume
 * de données (BUILD, FINANCE) ; "confortable" sert HOME, où l'utilisateur
 * client voit peu d'éléments à la fois.
 */

export type Density = 'dense' | 'confortable';

export interface DensityTokens {
  /** Hauteur d'une ligne (item de liste, ligne de tableau, item de sidebar). */
  rowHeight: string;
  paddingInline: string;
  paddingBlock: string;
  fontSize: string;
  /** Espacement entre éléments adjacents d'un même groupe. */
  gap: string;
}

export const densityTokens: Record<Density, DensityTokens> = {
  // Ticket F-073 — lisibilité : le corps « dense » passe de 13px à 14px
  // (retour utilisateur répété sur la lisibilité des écrans pros), le
  // « confortable » de 15px à 16px. Dense reste strictement plus compact.
  dense: {
    rowHeight: '36px',
    paddingInline: '12px',
    paddingBlock: '6px',
    fontSize: '14px',
    gap: '6px',
  },
  confortable: {
    rowHeight: '52px',
    paddingInline: '20px',
    paddingBlock: '14px',
    fontSize: '16px',
    gap: '10px',
  },
};

/** Liste ordonnée des densités valides — utile pour itérer dans les tests. */
export const ALL_DENSITIES: Density[] = ['dense', 'confortable'];
