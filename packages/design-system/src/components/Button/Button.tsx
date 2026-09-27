import type { ButtonHTMLAttributes } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * Ticket F-038 — premier composant `Button` du design system. Jusqu'ici
 * chaque écran (4 apps) écrivait son propre `<button>` brut, sans aucun
 * traitement visuel au-delà de la mise en page (voir CLAUDE.md, section
 * F-038 : constat né d'un rapport utilisateur sur `apps/web`).
 *
 * Trois variantes : `primary`/`secondary` réutilisent le ton "encre"
 * `semanticColors.neutral.text` déjà établi comme couleur d'emphase du
 * projet (état actif de `TabBar`/`AppShell`, ticket 023) — jamais une
 * couleur de marque inventée. `danger` est réservée EXCLUSIVEMENT à la
 * confirmation d'une action irréversible (ex : désactivation de compte,
 * `BackofficeView`) — jamais réutilisée pour un état d'alerte non-bloquant,
 * qui reste `AlertBanner`/`semanticColors.alert` (ambre).
 *
 * Ticket F-051 — mode sombre. `primary.color` : `semanticColors.neutral.
 * surface` (PAS un `#FFFFFF` figé) — `neutral.text` (le fond de ce bouton)
 * s'inverse de teinte entre thèmes (sombre en clair, clair en sombre), le
 * texte doit donc s'inverser AVEC lui pour rester lisible ; `neutral.
 * surface` fait exactement ça (blanc en clair, surface sombre en sombre),
 * vérifié en navigateur réel (Chromium, capture claire ET sombre) avant
 * intégration. `danger.background` → `danger.solid`, un token DÉDIÉ et
 * volontairement figé entre thèmes (voir sa docstring, `tokens/colors.ts`)
 * — `danger.border`/`.icon` s'inversent, eux, pour rester lisibles en
 * TEXTE sur le fond sombre d'`AlertBanner` ; les réutiliser ici aurait
 * rendu ce bouton illisible en mode sombre (rouge clair + texte blanc fixe
 * = contraste quasi nul, régression trouvée et corrigée AVANT ce commit
 * via la même capture d'écran).
 */
/**
 * Ticket F-073 (direction « Confiance premium ») — `primary` passe sur le
 * token dédié `semanticColors.primary` (navy en clair, or clair en
 * sombre) ; nouvelle variante `accent` (or plein, texte navy) réservée à
 * L'action décisive d'un écran (payer, valider, enregistrer l'avis) — une
 * seule par écran, jamais pour une action courante.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'danger';
}

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §5.3) : aucune ombre sur les boutons ; la
 * seule ombre du système est réservée aux menus et modales.
 */
const VARIANT_STYLE: Record<
  NonNullable<ButtonProps['variant']>,
  { background: string; color: string; border: string }
> = {
  primary: {
    background: semanticColors.primary.background,
    color: semanticColors.primary.text,
    border: 'none',
  },
  secondary: {
    background: 'transparent',
    color: semanticColors.neutral.heading,
    border: `1px solid ${semanticColors.neutral.border}`,
  },
  accent: {
    background: semanticColors.accent.solid,
    color: semanticColors.accent.onSolid,
    border: 'none',
  },
  danger: {
    background: semanticColors.danger.solid!,
    color: '#FFFFFF',
    border: 'none',
  },
};

export function Button({ variant = 'primary', style, className, ...rest }: ButtonProps) {
  const variantStyle = VARIANT_STYLE[variant];

  return (
    <button
      className={['keya-btn', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        minHeight: '44px',
        padding: '0 18px',
        borderRadius: '4px',
        fontSize: '15px',
        fontWeight: 700,
        ...variantStyle,
        ...style,
      }}
      {...rest}
    />
  );
}
