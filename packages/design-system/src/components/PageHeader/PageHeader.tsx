import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * Ticket F-073 — en-tête de page commun (direction « Confiance premium ») :
 * surtitre or en petites capitales (contexte : programme, lot…), titre
 * Fraunces, sous-titre optionnel, actions alignées à droite. Remplace les
 * `<h1>`/`<h2>` bruts posés différemment par chaque écran.
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
            style={{
              fontSize: '13px',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: semanticColors.accent.text,
            }}
          >
            {eyebrow}
          </span>
        )}
        <h1 style={{ margin: 0, fontSize: 'clamp(26px, 3vw, 34px)' }}>{title}</h1>
        {subtitle && (
          <div style={{ fontSize: '16px', color: semanticColors.neutral.textMuted, maxWidth: '72ch' }}>{subtitle}</div>
        )}
      </div>
      {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>{actions}</div>}
    </header>
  );
}
