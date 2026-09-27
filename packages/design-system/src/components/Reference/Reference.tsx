import { useState } from 'react';

import { semanticColors } from '../../tokens/colors';
import { typography } from '../../tokens/typography';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §9) : référence technique (bancaire
 * simulée, instance, version, empreinte, mission) en IBM Plex Mono, avec un
 * bouton « Copier » discret. Sans presse-papiers disponible, le bouton
 * n'est pas affiché : la référence reste sélectionnable.
 */
export interface ReferenceProps {
  value: string;
  /** Nom de la référence, pour le lecteur d'écran (« Référence bancaire simulée »). */
  label?: string;
  copyable?: boolean;
  'data-testid'?: string;
}

export function Reference({ value, label, copyable = true, 'data-testid': testId }: ReferenceProps) {
  const [copied, setCopied] = useState(false);
  const canCopy = copyable && typeof navigator !== 'undefined' && Boolean(navigator.clipboard);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%', flexWrap: 'wrap' }}>
      <code
        data-testid={testId}
        aria-label={label ? `${label} : ${value}` : undefined}
        style={{
          fontFamily: typography.monoFontFamily, fontSize: '0.92em', color: semanticColors.neutral.heading,
          overflowWrap: 'anywhere', background: 'transparent', padding: 0,
        }}
      >
        {value}
      </code>
      {canCopy && (
        <button
          type="button"
          className="keya-btn"
          onClick={() => { void copy(); }}
          aria-label={`Copier ${label ?? 'la référence'}`}
          style={{
            minHeight: '24px', padding: '0 6px', borderRadius: '4px', border: `1px solid ${semanticColors.neutral.border}`,
            background: 'transparent', color: semanticColors.neutral.textMuted, fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {copied ? 'Copié' : 'Copier'}
        </button>
      )}
    </span>
  );
}
