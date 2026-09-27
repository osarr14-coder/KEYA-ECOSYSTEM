import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * Ticket F-073 — en-tête de page commun : titre Fraunces, sous-titre
 * optionnel, actions alignées à droite.
 *
 * PO-2026-09-27-20 (DESIGN_SYSTEM §4, V01) : plus de sur-titre doré en
 * majuscules. `eyebrow` reste accepté pour porter un CONTEXTE utile (nom du
 * programme, date du jour) : texte secondaire, casse normale, jamais doré.
 * Un contexte déjà donné par la navigation (« Finance », « Ventes ») ne
 * doit pas être passé.
 */
export interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, eyebrow, subtitle, actions }: PageHeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: '16px 24px',
        marginBottom: '24px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexGrow: 1, minWidth: 'min(100%, 320px)' }}>
        {eyebrow && (
          <span
            data-testid="page-header-context"
            style={{ fontSize: '13px', fontWeight: 500, color: semanticColors.neutral.textMuted }}
          >
            {eyebrow}
          </span>
        )}
        <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3vw, 32px)' }}>{title}</h1>
        {subtitle && (
          <div style={{ fontSize: '15px', color: semanticColors.neutral.textMuted, maxWidth: '72ch' }}>{subtitle}</div>
        )}
      </div>
      {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>{actions}</div>}
    </header>
  );
}
