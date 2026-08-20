import type { InputHTMLAttributes } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * Ticket F-038 — voir `Button.tsx` pour le contexte complet. Bordure neutre
 * au repos, remplacée au focus par la classe partagée `.keya-input`
 * (`GlobalStyles`, seul endroit du projet qui gère `:focus-visible`) —
 * jamais une couleur nouvelle, le même ton "encre" que `Button` primary.
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ style, className, ...rest }: InputProps) {
  return (
    <input
      className={['keya-input', className].filter(Boolean).join(' ')}
      style={{
        display: 'block',
        width: '100%',
        minHeight: '40px',
        padding: '0 12px',
        borderRadius: '8px',
        border: `1px solid ${semanticColors.neutral.border}`,
        fontSize: '14px',
        color: semanticColors.neutral.text,
        background: semanticColors.neutral.surface,
        ...style,
      }}
      {...rest}
    />
  );
}
