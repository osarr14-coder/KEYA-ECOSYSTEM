import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';
import { DateTime } from '../DateTime/DateTime';
import { Pill, type PillTone } from '../Pill/Pill';
import { Reference } from '../Reference/Reference';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §10) : historique de versions d'un
 * contrat ou d'une pièce. La version courante est en avant ; les versions
 * antérieures restent consultables (jamais supprimées). Chaque avis reste
 * attaché à la version examinée (K01).
 */
export interface VersionReview {
  id: string;
  author: string;
  verdict: string;
  at: string;
  text?: string;
}

export interface VersionEntry {
  id: string;
  version: string;
  statusLabel: string;
  statusTone?: PillTone;
  at: string;
  author?: string;
  reviews?: VersionReview[];
  content?: ReactNode;
}

function VersionBlock({ entry, current }: { entry: VersionEntry; current: boolean }) {
  return (
    <div
      data-testid={current ? 'version-current' : 'version-previous'}
      style={{
        display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', borderRadius: '6px',
        border: `1px solid ${current ? semanticColors.neutral.heading : semanticColors.neutral.border}`,
        background: semanticColors.neutral.surface,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <strong>{current ? 'Version courante' : 'Version antérieure'}</strong>
        <Reference value={entry.version} label="Version" copyable={false} />
        <Pill tone={entry.statusTone ?? 'neutral'}>{entry.statusLabel}</Pill>
      </div>
      <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        {entry.author ? `${entry.author} · ` : ''}
        <DateTime value={entry.at} />
      </span>
      {entry.content}
      {entry.reviews && entry.reviews.length > 0 && (
        <ul aria-label={`Avis sur la version ${entry.version}`} style={{ margin: 0, paddingLeft: '18px', fontSize: '14px' }}>
          {entry.reviews.map((review) => (
            <li key={review.id}>
              <strong>{review.verdict}</strong>
              {` — ${review.author}, `}
              <DateTime value={review.at} />
              {review.text ? ` : ${review.text}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface VersionHistoryProps {
  /** Du plus récent au plus ancien ; le premier est la version courante. */
  versions: VersionEntry[];
}

export function VersionHistory({ versions }: VersionHistoryProps) {
  if (versions.length === 0) {
    return <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>Aucune version déposée.</p>;
  }
  const [current, ...previous] = versions;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <VersionBlock entry={current} current />
      {previous.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {`Versions antérieures (${previous.length}) — conservées, jamais supprimées`}
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
            {previous.map((entry) => <VersionBlock key={entry.id} entry={entry} current={false} />)}
          </div>
        </details>
      )}
    </div>
  );
}
