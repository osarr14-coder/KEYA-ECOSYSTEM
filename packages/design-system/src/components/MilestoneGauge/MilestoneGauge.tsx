import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';
import { Pill } from '../Pill/Pill';
import {
  MILESTONE_STATE_LABELS, MILESTONE_STATE_TONES, MILESTONE_STATES, SEGMENT_STYLES, UNKNOWN_SEGMENT_STYLE,
  reportUnknownMilestoneState, resolveMilestoneState,
} from './milestoneStates';

/**
 * PO-2026-09-28-27 — jauge segmentée des jalons (référence
 * `docs/design/references/jauge-jalons-reference.html`).
 *
 * - Un segment par jalon, dans l'ordre du chantier, de LARGEUR ÉGALE : un
 *   segment plus large reviendrait à pondérer, donc à calculer un avancement.
 * - Aucun pourcentage, aucun ratio : le compteur « n / N » est du texte,
 *   fourni par l'appelant à côté de la jauge.
 * - La jauge ne représente pas les niveaux de confiance (ils restent dans le
 *   détail du jalon).
 * - L'état vient du seul `cdc_state` calculé par le serveur ; un état
 *   inconnu est une erreur visible, jamais « accepté » par défaut.
 * - Version carte : chaque segment est un bouton (Tab, Entrée), cible
 *   tactile de 44 px ; le segment sélectionné prend un contour de 2 px à
 *   l'encre. Version compacte : segments de 8 px, lecture seule.
 * - Lue comme une liste ordonnée : « Jalon 1 sur 2, Fondations,
 *   Corrections demandées, 1 réserve ouverte ».
 */
export interface GaugeMilestone {
  id: string;
  /** Code du jalon (`fondations`…), repris dans `data-testid`. */
  code?: string;
  label: string;
  /** `cdc_state` du serveur. */
  cdcState: string;
  /** Libellé d'état du serveur (sinon celui du design system). */
  statusLabel?: string;
  openReserveCount?: number;
  /** Ligne d'information sous le libellé (version carte). */
  meta?: ReactNode;
}

export interface MilestoneGaugeProps {
  milestones: GaugeMilestone[];
  variant?: 'card' | 'compact';
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  'aria-label'?: string;
}

export function milestoneAccessibleLabel(milestone: GaugeMilestone, index: number, total: number) {
  const state = resolveMilestoneState(milestone.cdcState);
  const status = milestone.statusLabel || (state ? MILESTONE_STATE_LABELS[state] : `État inconnu (${milestone.cdcState})`);
  const reserves = milestone.openReserveCount
    ? `, ${milestone.openReserveCount} réserve${milestone.openReserveCount > 1 ? 's' : ''} ouverte${milestone.openReserveCount > 1 ? 's' : ''}`
    : '';
  return `Jalon ${index + 1} sur ${total}, ${milestone.label}, ${status}${reserves}`;
}

const visuallyHidden = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
} as const;

export function Segment({ cdcState, height, selected = false }: { cdcState: string; height: number; selected?: boolean }) {
  const state = resolveMilestoneState(cdcState);
  if (!state) reportUnknownMilestoneState(cdcState);
  return (
    <span
      aria-hidden="true"
      data-testid="gauge-segment"
      data-state={state ?? 'UNKNOWN'}
      style={{
        display: 'block', flex: '1 1 auto', alignSelf: 'center', height: `${height}px`, borderRadius: '2px',
        ...(state ? SEGMENT_STYLES[state] : UNKNOWN_SEGMENT_STYLE),
        ...(selected ? { outline: `2px solid ${semanticColors.neutral.heading}`, outlineOffset: '3px' } : {}),
      }}
    />
  );
}

export function MilestoneGauge({
  milestones, variant = 'card', selectedId = null, onSelect, 'aria-label': ariaLabel = 'Jalons du chantier',
}: MilestoneGaugeProps) {
  const total = milestones.length;
  const columns = `repeat(${Math.max(total, 1)}, minmax(0, 1fr))`;

  if (variant === 'compact') {
    return (
      <ol
        aria-label={ariaLabel}
        data-testid="milestone-gauge"
        data-variant="compact"
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: columns, gap: '4px', width: '132px' }}
      >
        {milestones.map((milestone, index) => (
          <li key={milestone.id} style={{ position: 'relative' }}>
            <Segment cdcState={milestone.cdcState} height={8} />
            <span style={visuallyHidden}>{milestoneAccessibleLabel(milestone, index, total)}</span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol
      aria-label={ariaLabel}
      data-testid="milestone-gauge"
      data-variant="card"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: columns, columnGap: '12px' }}
    >
      {milestones.map((milestone, index) => {
        const state = resolveMilestoneState(milestone.cdcState);
        const selected = milestone.id === selectedId;
        const status = milestone.statusLabel || (state ? MILESTONE_STATE_LABELS[state] : `État inconnu : ${milestone.cdcState}`);
        return (
          <li key={milestone.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            <button
              type="button"
              aria-pressed={selected}
              aria-label={milestoneAccessibleLabel(milestone, index, total)}
              onClick={() => onSelect?.(milestone.id)}
              style={{
                display: 'flex', alignItems: 'center', alignSelf: 'stretch', minHeight: '44px', padding: '0 4px',
                border: 'none', background: 'transparent', cursor: onSelect ? 'pointer' : 'default',
              }}
            >
              <Segment cdcState={milestone.cdcState} height={12} selected={selected} />
            </button>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
              <span style={{ fontSize: '11px', color: semanticColors.neutral.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <strong style={{ fontSize: '16px', color: semanticColors.neutral.heading, overflowWrap: 'anywhere' }}>{milestone.label}</strong>
            </span>
            <span data-testid={milestone.code ? `milestone-status-${milestone.code}` : undefined}>
              <Pill tone={state ? MILESTONE_STATE_TONES[state] : 'danger'}>{status}</Pill>
            </span>
            {milestone.meta && (
              <span style={{ fontSize: '12.5px', color: semanticColors.neutral.textMuted }}>{milestone.meta}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Légende des états (forme + libellé, jamais la couleur seule). */
export function MilestoneGaugeLegend() {
  const order: (typeof MILESTONE_STATES)[number][] = [
    'TECHNICALLY_ACCEPTED', 'UNDER_REVIEW', 'SUBMITTED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', 'DRAFT',
  ];
  return (
    <ul
      aria-label="Légende de la jauge"
      style={{
        listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 22px',
        fontSize: '12px', color: semanticColors.neutral.textMuted,
      }}
    >
      {order.map((state) => (
        <li key={state} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-block', width: '28px' }}><Segment cdcState={state} height={8} /></span>
          {state === 'SUBMITTED' ? 'Soumis · Resoumis' : MILESTONE_STATE_LABELS[state]}
        </li>
      ))}
    </ul>
  );
}
