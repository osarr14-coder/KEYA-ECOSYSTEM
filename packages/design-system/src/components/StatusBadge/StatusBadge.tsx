import { useEffect, useRef, useState } from 'react';

import { semanticColors } from '../../tokens/colors';
import { ALL_TRUST_LEVELS, LEVEL_META, type TrustLevel } from './levelMeta';
import { SHAPE_BY_LEVEL, ShapeIcon } from './shapes';

export { ALL_TRUST_LEVELS, LEVEL_META };
export type { TrustLevel };

/**
 * Forme du popover : correspond au retour de
 * `apps/trust/repository.py::get_current_status` côté backend (ticket 003) —
 * un TrustEvent, jamais un score ou un pourcentage calculé. `actor` et
 * `scope` arrivent déjà formatés pour l'affichage (ce package ne connaît pas
 * la forme brute des objets Django).
 */
export interface TrustEventData {
  level: TrustLevel;
  source: string;
  actor: string;
  scope?: string;
  createdAt: string | Date;
}

export interface StatusBadgeProps {
  level: TrustLevel;
  /** Données du TrustEvent courant, pour le popover. Sans elles, le badge
   * s'affiche normalement mais le clic n'ouvre qu'un message d'indisponibilité
   * plutôt que d'échouer silencieusement. */
  event?: TrustEventData;
  className?: string;
}

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function StatusBadge({ level, event, className }: StatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const meta = LEVEL_META[level];
  const shape = SHAPE_BY_LEVEL[level];

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(mouseEvent: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(mouseEvent.target as Node)) {
        setOpen(false);
      }
    }
    // Ticket 024 (audit accessibilite) - role="dialog" sans moyen clavier de
    // le refermer (seuls le clic exterieur et un second clic sur le bouton
    // fonctionnaient) : ajout minimal, n'affecte aucune interaction souris
    // existante.
    function handleEscape(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid="status-badge"
      data-level={level}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          border: `1px solid ${meta.color}`,
          color: meta.color,
          borderRadius: '999px',
          padding: '2px 10px',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <ShapeIcon shape={shape} />
        <span>{meta.label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Détail de statut : ${meta.label}`}
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '4px', minWidth: '220px',
            background: semanticColors.neutral.surface,
            border: `1px solid ${semanticColors.neutral.border}`,
            borderRadius: '8px',
            padding: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 10,
          }}
        >
          {event ? (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px' }}>
              <dt>Source</dt>
              <dd style={{ margin: 0 }}>{event.source}</dd>
              <dt>Date</dt>
              <dd style={{ margin: 0 }}>{formatDate(event.createdAt)}</dd>
              <dt>Acteur</dt>
              <dd style={{ margin: 0 }}>{event.actor}</dd>
              <dt>Scope</dt>
              <dd style={{ margin: 0 }}>{event.scope || '—'}</dd>
            </dl>
          ) : (
            <p style={{ margin: 0 }}>Aucun événement disponible pour ce statut.</p>
          )}
        </div>
      )}
    </div>
  );
}
