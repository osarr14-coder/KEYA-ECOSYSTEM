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
  dense: {
    rowHeight: '32px',
    paddingInline: '8px',
    paddingBlock: '4px',
    fontSize: '13px',
    gap: '4px',
  },
  confortable: {
    rowHeight: '48px',
    paddingInline: '16px',
    paddingBlock: '12px',
    fontSize: '15px',
    gap: '8px',
  },
};

/** Liste ordonnée des densités valides — utile pour itérer dans les tests. */
export const ALL_DENSITIES: Density[] = ['dense', 'confortable'];
