import type { CSSProperties } from 'react';

import type { PillTone } from '../Pill/Pill';

/**
 * PO-2026-09-28-27 — états de travail d'un jalon (CDC §7.1), tels que le
 * SERVEUR les calcule (`cdc_state`, A-DS-4). Le front n'en invente aucun.
 *
 * PO-2026-09-28-31 :
 * - seul le code serveur `CHANGES_REQUESTED` est accepté ; il correspond au
 *   `CHANGES_REQUIRED` du CDC §7.1 (glossaire, DESIGN_SYSTEM §8.3). Un code
 *   non reconnu reste une erreur visible, jamais un état « accepté » ;
 * - `REVIEW_REQUIRED` se libelle « Nouvelle revue nécessaire » (vocabulaire
 *   du CDC §7.1) : état calculé par le serveur pour l'affichage (T07) ;
 * - brouillon : « Brouillon » dans les espaces de travail, « Pas encore
 *   déclaré » pour le client et la page publique (`audience`).
 */
export type MilestoneState =
  | 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CHANGES_REQUESTED' | 'RESUBMITTED'
  | 'TECHNICALLY_ACCEPTED' | 'REVIEW_REQUIRED';

export const MILESTONE_STATES: MilestoneState[] = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'RESUBMITTED', 'TECHNICALLY_ACCEPTED', 'REVIEW_REQUIRED',
];

export const MILESTONE_STATE_LABELS: Record<MilestoneState, string> = {
  DRAFT: 'Brouillon',
  SUBMITTED: 'Soumis',
  UNDER_REVIEW: 'En examen',
  CHANGES_REQUESTED: 'Corrections demandées',
  RESUBMITTED: 'Resoumis',
  TECHNICALLY_ACCEPTED: 'Accepté techniquement',
  REVIEW_REQUIRED: 'Nouvelle revue nécessaire',
};

/** Public d'un libellé d'état : espaces de travail, ou client et page publique. */
export type MilestoneAudience = 'workspace' | 'client';

export const MILESTONE_CLIENT_STATE_LABELS: Record<MilestoneState, string> = {
  ...MILESTONE_STATE_LABELS,
  DRAFT: 'Pas encore déclaré',
};

export function milestoneStateLabel(state: MilestoneState, audience: MilestoneAudience = 'workspace') {
  return (audience === 'client' ? MILESTONE_CLIENT_STATE_LABELS : MILESTONE_STATE_LABELS)[state];
}

export const MILESTONE_STATE_TONES: Record<MilestoneState, PillTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  CHANGES_REQUESTED: 'alert',
  RESUBMITTED: 'info',
  TECHNICALLY_ACCEPTED: 'success',
  REVIEW_REQUIRED: 'alert',
};

/** `null` si l'état n'est pas connu : jamais « accepté » par défaut. */
export function resolveMilestoneState(code: string | null | undefined): MilestoneState | null {
  if (!code) return null;
  return (MILESTONE_STATES as string[]).includes(code) ? code as MilestoneState : null;
}

/** Erreur visible en développement pour un état inconnu (E). */
export function reportUnknownMilestoneState(code: string | null | undefined) {
  if (import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.error(`État de jalon inconnu : « ${code ?? 'vide'} » (cdc_state attendu parmi ${MILESTONE_STATES.join(', ')}).`);
  }
}

const INFO = 'var(--keya-info-text)';
const INFO_BG = 'var(--keya-info-background)';
const WARN = 'var(--keya-alert-text)';
const WARN_BG = 'var(--keya-alert-background)';
const OK = 'var(--keya-success-text)';
const OK_BG = 'var(--keya-success-background)';
const LINE = 'var(--keya-neutral-text-muted)';
const SURFACE = 'var(--keya-neutral-surface)';

/** Rendu d'un segment, repris de la référence `jauge-jalons-reference.html`.
 * Hachures à arrêts francs (lisibles en niveaux de gris), jamais de dégradé. */
export const SEGMENT_STYLES: Record<MilestoneState, CSSProperties> = {
  DRAFT: { background: SURFACE, boxShadow: `inset 0 0 0 1px ${LINE}` },
  SUBMITTED: { background: INFO_BG, boxShadow: `inset 0 0 0 1px ${INFO}` },
  UNDER_REVIEW: {
    background: `repeating-linear-gradient(135deg, ${INFO} 0 1.5px, ${INFO_BG} 1.5px 5px)`,
    boxShadow: `inset 0 0 0 1px ${INFO}`,
  },
  CHANGES_REQUESTED: {
    background: `repeating-linear-gradient(135deg, ${WARN} 0 2px, ${WARN_BG} 2px 6px)`,
    boxShadow: `inset 0 0 0 1px ${WARN}`,
  },
  RESUBMITTED: { background: INFO_BG, boxShadow: `inset 0 0 0 1px ${INFO}` },
  TECHNICALLY_ACCEPTED: { background: OK },
  REVIEW_REQUIRED: { background: OK_BG, outline: `1.5px dashed ${OK}`, outlineOffset: '-1.5px' },
};

/** État inconnu : erreur visible (rouge réservé aux erreurs, PO-2026-09-28-17). */
export const UNKNOWN_SEGMENT_STYLE: CSSProperties = {
  background: 'var(--keya-danger-background)', outline: '1.5px dashed var(--keya-danger-border)', outlineOffset: '-1.5px',
};
