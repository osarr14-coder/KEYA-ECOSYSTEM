import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * Ticket F-073 — étiquette d'état métier (réservation, appel de fonds,
 * mission…). Volontairement DISTINCTE de `StatusBadge` (niveaux Visible
 * Trust) : les niveaux de confiance ont leur propre grammaire (échelle).
 *
 * Audit UI R1, étape 3 — PO-2026-09-27-20 (DESIGN_SYSTEM §8, constats V06 et
 * V09) : **badge compact**, rayon 4 px, hauteur 20 px, point de couleur +
 * libellé. Le doré n'est jamais un état : `accent` (historique) s'affiche
 * comme « action attendue » (Attention) et `primary` comme « en cours »
 * (Information). Le libellé reste toujours explicite (jamais la couleur
 * seule).
 */
export type PillTone = 'neutral' | 'primary' | 'accent' | 'success' | 'alert' | 'danger' | 'info';

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  'data-testid'?: string;
}

type Family = 'neutral' | 'info' | 'success' | 'alert' | 'danger';

/** Famille visuelle d'un ton (§8.2). */
export const TONE_FAMILY: Record<PillTone, Family> = {
  neutral: 'neutral',
  primary: 'info',
  info: 'info',
  accent: 'alert',
  alert: 'alert',
  success: 'success',
  danger: 'danger',
};

const FAMILY_STYLE: Record<Family, { background: string; color: string; dot: string }> = {
  neutral: { background: semanticColors.neutral.subtle, color: semanticColors.neutral.text, dot: semanticColors.neutral.textMuted },
  info: { background: semanticColors.info.background, color: semanticColors.info.text, dot: semanticColors.info.text },
  success: { background: semanticColors.success.background, color: semanticColors.success.text, dot: semanticColors.success.text },
  alert: { background: semanticColors.alert.background, color: semanticColors.alert.text, dot: semanticColors.alert.border },
  danger: { background: semanticColors.danger.background, color: semanticColors.danger.text, dot: semanticColors.danger.border },
};

export function Pill({ tone = 'neutral', children, 'data-testid': testId }: PillProps) {
  const family = TONE_FAMILY[tone];
  const style = FAMILY_STYLE[family];
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      data-family={family}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        minHeight: '20px',
        boxSizing: 'border-box',
        padding: '1px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        background: style.background,
        color: style.color,
      }}
    >
      <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: style.dot, flexShrink: 0 }} />
      {children}
    </span>
  );
}
