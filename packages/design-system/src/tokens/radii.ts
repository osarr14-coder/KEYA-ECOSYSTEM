/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §5.2, constats V04 et V09) — deux rayons
 * seulement : 4 px pour les contrôles (champs, boutons, badges, marqueurs),
 * 6 px pour les panneaux (tableaux, sections, justificatifs). Rien au-delà ;
 * seuls les éléments circulaires (avatar, point d'état) utilisent `50%`.
 */
export const radii = {
  control: '4px',
  panel: '6px',
} as const;
