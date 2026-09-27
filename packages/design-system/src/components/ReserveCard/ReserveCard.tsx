import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';
import { DateTime } from '../DateTime/DateTime';
import { Pill, type PillTone } from '../Pill/Pill';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §10) : réserve du contrôleur — état
 * (ouverte … levée), date, auteur, motif, action attendue, correction
 * proposée, décision du contrôleur. Reprend les champs structurés de
 * l'étape 1 (K02, K03). Les actions éventuelles sont passées par l'appelant
 * (`actions`) ; une action interdite reste visible, désactivée, avec son
 * explication (`actionNote`).
 */
export type ReserveState = 'open' | 'correction_proposed' | 'recheck' | 'maintained' | 'lifted';

const STATE_TONE: Record<ReserveState, PillTone> = {
  open: 'danger',
  correction_proposed: 'alert',
  recheck: 'info',
  maintained: 'danger',
  lifted: 'success',
};

export const RESERVE_STATE_LABELS: Record<ReserveState, string> = {
  open: 'Ouverte',
  correction_proposed: 'Correction proposée',
  recheck: 'En recontrôle',
  maintained: 'Maintenue',
  lifted: 'Levée',
};

export interface ReserveCardProps {
  state: ReserveState;
  stateLabel?: string;
  title: string;
  openedAt: string;
  openedBy: string;
  reason: string;
  expectedAction: string;
  proposedCorrection?: string;
  decision?: { by: string; at: string; text: string };
  actions?: ReactNode;
  actionNote?: string;
}

export function ReserveCard({
  state, stateLabel, title, openedAt, openedBy, reason, expectedAction, proposedCorrection, decision, actions, actionNote,
}: ReserveCardProps) {
  const muted = { color: semanticColors.neutral.textMuted } as const;
  return (
    <article
      aria-label={`Réserve — ${title}`}
      data-testid="reserve-card"
      data-state={state}
      style={{
        display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px', borderRadius: '6px',
        border: `1px solid ${state === 'lifted' ? semanticColors.neutral.border : semanticColors.danger.border}`,
        background: semanticColors.neutral.surface,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <strong>{title}</strong>
        <Pill tone={STATE_TONE[state]}>{stateLabel ?? RESERVE_STATE_LABELS[state]}</Pill>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0, fontSize: '14px' }}>
        <dt style={muted}>Ouverte par</dt>
        <dd style={{ margin: 0 }}>{`${openedBy}, `}<DateTime value={openedAt} /></dd>
        <dt style={muted}>Motif</dt>
        <dd style={{ margin: 0 }}>{reason}</dd>
        <dt style={muted}>Action attendue</dt>
        <dd style={{ margin: 0 }}>{expectedAction}</dd>
        <dt style={muted}>Correction proposée</dt>
        <dd style={{ margin: 0 }}>{proposedCorrection ?? 'Aucune pour le moment'}</dd>
        <dt style={muted}>Décision du contrôleur</dt>
        <dd style={{ margin: 0 }}>
          {decision ? <>{`${decision.text} — ${decision.by}, `}<DateTime value={decision.at} /></> : 'En attente'}
        </dd>
      </dl>
      {(actions || actionNote) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {actions}
          {actionNote && <span style={{ fontSize: '13px', ...muted }}>{actionNote}</span>}
        </div>
      )}
    </article>
  );
}
