import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * Ticket F-073 — pastille d'état générique (« Réservée », « À valider »,
 * « Payé »…). Volontairement DISTINCTE de `StatusBadge` : `StatusBadge`
 * représente EXCLUSIVEMENT les 5 niveaux Visible Trust (levelMeta.ts,
 * jamais modifié) ; `Pill` étiquette un état métier courant (réservation,
 * appel de fonds, mission). Le ton porte le sens, le texte reste toujours
 * explicite (jamais la couleur seule).
 */
export type PillTone = 'neutral' | 'primary' | 'accent' | 'success' | 'alert' | 'danger';

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  'data-testid'?: string;
}

const TONE_STYLE: Record<PillTone, { background: string; color: string }> = {
  neutral: { background: semanticColors.neutral.subtle, color: semanticColors.neutral.textMuted },
  primary: { background: semanticColors.primary.background, color: semanticColors.primary.text },
  accent: { background: semanticColors.accent.soft, color: semanticColors.accent.text },
  success: { background: semanticColors.success.background, color: semanticColors.success.text },
  alert: { background: semanticColors.alert.background, color: semanticColors.alert.text },
  danger: { background: semanticColors.danger.background, color: semanticColors.danger.text },
};

export function Pill({ tone = 'neutral', children, 'data-testid': testId }: PillProps) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 12px',
        borderRadius: '999px',
        fontSize: '13px',
        fontWeight: 700,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        ...TONE_STYLE[tone],
      }}
    >
      {children}
    </span>
  );
}
