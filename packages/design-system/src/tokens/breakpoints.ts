/**
 * Ticket F-050 — seuil mobile UNIQUE, partagé entre `useIsMobile` (JS,
 * pilote le rendu compact d'`AppShell`) et la media query CSS de
 * `GlobalStyles` (ce qu'un style inline ne peut pas exprimer, même
 * discipline que les pseudo-classes `:hover`/`:focus-visible`, ticket
 * F-038) — une seule valeur, jamais deux constantes à resynchroniser
 * manuellement.
 */
export const MOBILE_BREAKPOINT_PX = 640;
