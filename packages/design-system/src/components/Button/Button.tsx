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
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

const VARIANT_STYLE: Record<NonNullable<ButtonProps['variant']>, { background: string; color: string; border: string }> = {
  primary: {
    background: semanticColors.neutral.text,
    color: '#FFFFFF',
    border: 'none',
  },
  secondary: {
    background: 'transparent',
    color: semanticColors.neutral.text,
    border: `1px solid ${semanticColors.neutral.border}`,
  },
  danger: {
    background: semanticColors.danger.border,
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
        gap: '6px',
        minHeight: '44px',
        padding: '0 16px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 600,
        ...variantStyle,
        ...style,
      }}
      {...rest}
    />
  );
}
