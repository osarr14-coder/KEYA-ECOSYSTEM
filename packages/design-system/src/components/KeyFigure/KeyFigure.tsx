import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';
import { typography } from '../../tokens/typography';

/**
 * Ticket F-075 — chiffre clé (tableau de bord « À faire », fiche dossier) :
 * libellé, valeur en Fraunces, précision optionnelle. Avec `onClick`, la
 * tuile entière devient un bouton (raccourci vers l'écran concerné) ; le
 * ton `accent` signale un chiffre qui appelle une action.
 *
 * PO-2026-09-27-20 (DESIGN_SYSTEM V03, V06) : chiffre en Manrope à chiffres
 * tabulaires (plus de grand chiffre à empattements), zéro discret, aucun
 * doré — un chiffre qui appelle une action prend la couleur Attention.
 */
export interface KeyFigureProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** `alert` (ou son alias historique `accent`) : chiffre qui appelle une action. */
  tone?: 'neutral' | 'accent' | 'alert' | 'success';
  onClick?: () => void;
  /** Valeur textuelle (nom, date) : corps de texte plutôt que grand chiffre. */
  textual?: boolean;
  'data-testid'?: string;
}

export function KeyFigure({
  label, value, hint, tone = 'neutral', onClick, textual = false, 'data-testid': testId,
}: KeyFigureProps) {
  // Zéro discret, y compris un montant formaté (« 0 XOF »).
  const isZero = value === 0 || (typeof value === 'string' && /^0(\s[A-Z]{3})?$/.test(value.trim()));
  const valueColor = isZero
    ? semanticColors.neutral.textMuted
    : tone === 'accent' || tone === 'alert'
      ? semanticColors.alert.text
      : tone === 'success' ? semanticColors.success.text : semanticColors.neutral.heading;
  const content = (
    <>
      <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted, fontWeight: 600 }}>{label}</span>
      <span
        data-testid={testId ? `${testId}-value` : undefined}
        style={textual ? {
          fontFamily: typography.fontFamily, fontSize: '16px', fontWeight: 700, lineHeight: 1.4, color: valueColor,
        } : {
          fontFamily: typography.fontFamily,
          fontSize: '22px',
          fontWeight: isZero ? 500 : 700,
          lineHeight: 1.2,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
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
    padding: '12px 16px',
    borderRadius: '6px',
    border: `1px solid ${semanticColors.neutral.border}`,
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
