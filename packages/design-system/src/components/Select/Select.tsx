import type { SelectHTMLAttributes } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * Ticket F-038 — même famille visuelle que `Input` (voir `Input.tsx`).
 * Aucun écran de ce ticket n'en a un usage réel (`BackofficeView`, seul
 * écran migré par ce ticket, ne contient aucun `<select>`) — construit ici
 * avec ses tests pour que le prochain écran qui en a besoin (un futur
 * ticket de migration, voir CLAUDE.md section F-038) le réutilise
 * directement plutôt que d'écrire, une fois de plus, un `<select>` brut.
 */
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ style, className, children, ...rest }: SelectProps) {
  return (
    <select
      className={['keya-select', className].filter(Boolean).join(' ')}
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
    >
      {children}
    </select>
  );
}
