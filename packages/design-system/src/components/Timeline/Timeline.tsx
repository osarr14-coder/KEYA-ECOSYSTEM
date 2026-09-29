import { semanticColors } from '../../tokens/colors';
import { DateTime } from '../DateTime/DateTime';
import { Reference } from '../Reference/Reference';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §10) : chronologie d'audit — liste
 * verticale sobre, en LECTURE SEULE (aucun bouton d'édition). Chaque entrée
 * dit qui (acteur + rôle), quoi, quand (date serveur, fuseau affiché),
 * pourquoi (justification) et sur quel objet (et quelle version).
 */
export interface TimelineEntry {
  id: string;
  actor: string;
  role: string;
  action: string;
  at: string;
  justification?: string;
  object?: { label: string; version?: string; href?: string };
}

export interface TimelineProps {
  entries: TimelineEntry[];
  'aria-label'?: string;
  emptyText?: string;
}

export function Timeline({ entries, 'aria-label': ariaLabel = 'Chronologie', emptyText = 'Aucun événement enregistré.' }: TimelineProps) {
  if (entries.length === 0) {
    return <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>{emptyText}</p>;
  }
  return (
    <ol aria-label={ariaLabel} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          data-testid="timeline-entry"
          style={{ display: 'grid', gridTemplateColumns: '16px 1fr', gap: '12px' }}
        >
          <span aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ width: '8px', height: '8px', marginTop: '7px', borderRadius: '50%', background: semanticColors.neutral.heading }} />
            {index < entries.length - 1 && <span style={{ flex: 1, width: '1px', background: semanticColors.neutral.border }} />}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingBottom: '16px', minWidth: 0 }}>
            <span style={{ fontWeight: 600, color: semanticColors.neutral.heading }}>{entry.action}</span>
            <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>
              {/* Lot 4 : le rôle peut manquer (action automatique). */}
              {`${[entry.actor, entry.role].filter(Boolean).join(' · ')} · `}
              <DateTime value={entry.at} />
            </span>
            {entry.justification && <span style={{ fontSize: '14px' }}>{`Motif : ${entry.justification}`}</span>}
            {entry.object && (
              <span style={{ fontSize: '13px', display: 'inline-flex', gap: '6px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                {entry.object.href ? <a href={entry.object.href}>{entry.object.label}</a> : <span>{entry.object.label}</span>}
                {entry.object.version && <Reference value={entry.object.version} label="Version" copyable={false} />}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
