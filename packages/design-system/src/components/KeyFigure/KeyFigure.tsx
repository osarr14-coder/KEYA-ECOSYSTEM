import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';
import { typography } from '../../tokens/typography';

/**
 * Ticket F-075 — chiffre clé (tableau de bord « À faire », fiche dossier) :
 * libellé, valeur en Fraunces, précision optionnelle. Avec `onClick`, la
 * tuile entière devient un bouton (raccourci vers l'écran concerné) ; le
 * ton `accent` signale un chiffre qui appelle une action.
 */
export interface KeyFigureProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'accent' | 'success';
  onClick?: () => void;
  /** Valeur textuelle (nom, date) : corps de texte plutôt que grand chiffre. */
  textual?: boolean;
  'data-testid'?: string;
}

export function KeyFigure({
  label, value, hint, tone = 'neutral', onClick, textual = false, 'data-testid': testId,
}: KeyFigureProps) {
  const valueColor = tone === 'accent'
    ? semanticColors.accent.text
    : tone === 'success' ? semanticColors.success.text : semanticColors.neutral.heading;
  const content = (
    <>
      <span style={{ fontSize: '14px', color: semanticColors.neutral.textMuted, fontWeight: 600 }}>{label}</span>
      <span
        data-testid={testId ? `${testId}-value` : undefined}
        style={textual ? {
          fontFamily: typography.fontFamily, fontSize: '16px', fontWeight: 700, lineHeight: 1.4, color: valueColor,
        } : {
          fontFamily: typography.headingFontFamily, fontSize: '28px', fontWeight: 600, lineHeight: 1.15, color: valueColor,
        }}
      >
        {value}
      </span>
      {hint && <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>{hint}</span>}
    </>
  );
  const style = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    padding: '18px 20px',
    borderRadius: '18px',
    border: `1px solid ${tone === 'accent' ? semanticColors.accent.solid : semanticColors.neutral.border}`,
    background: semanticColors.neutral.surface,
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    minWidth: 0,
  } as const;

  if (onClick) {
    return (
      <button type="button" className="keya-btn" data-testid={testId} onClick={onClick} style={{ ...style, cursor: 'pointer' }}>
        {content}
      </button>
    );
  }
  return <div data-testid={testId} style={style}>{content}</div>;
}
