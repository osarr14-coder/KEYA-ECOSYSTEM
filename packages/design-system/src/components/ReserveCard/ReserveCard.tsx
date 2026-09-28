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

// PO-2026-09-28-17 : une réserve ouverte attend une action (Attention) ; le
// rouge reste aux refus — ici, la réserve MAINTENUE après recontrôle.
const STATE_TONE: Record<ReserveState, PillTone> = {
  open: 'alert',
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
        border: `1px solid ${
          state === 'lifted' ? semanticColors.neutral.border
            : state === 'maintained' ? semanticColors.danger.border : semanticColors.alert.border
        }`,
        background: semanticColors.neutral.surface,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <strong>{title}</strong>
        <Pill tone={STATE_TONE[state]}>{stateLabel ?? RESERVE_STATE_LABELS[state]}</Pill>
      </div>
      {/* Étape 5 (captures 375 px) : chaque ligne passe sous son libellé
          quand la place manque, au lieu de déborder du cadre. */}
      <dl style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: 0, fontSize: '14px' }}>
        {([
          ['Ouverte par', <>{`${openedBy}, `}<DateTime value={openedAt} /></>],
          ['Motif', reason],
          ['Action attendue', expectedAction],
          ['Correction proposée', proposedCorrection ?? 'Aucune pour le moment'],
          ['Décision du contrôleur', decision
            ? <>{`${decision.text} — ${decision.by}, `}<DateTime value={decision.at} /></>
            : 'En attente'],
        ] as [string, ReactNode][]).map(([term, value]) => (
          <div key={term} style={{ display: 'flex', flexWrap: 'wrap', columnGap: '16px', rowGap: '2px' }}>
            <dt style={{ ...muted, flex: '0 0 160px' }}>{term}</dt>
            <dd style={{ margin: 0, flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</dd>
          </div>
        ))}
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
