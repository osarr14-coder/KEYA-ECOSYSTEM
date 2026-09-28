import type { CSSProperties } from 'react';

import type { PillTone } from '../Pill/Pill';

/**
 * PO-2026-09-28-27 — états de travail d'un jalon (CDC §7.1), tels que le
 * SERVEUR les calcule (`cdc_state`, A-DS-4). Le front n'en invente aucun.
 *
 * Écarts signalés au Product Owner, non tranchés ici :
 * - le serveur code « Corrections demandées » `CHANGES_REQUESTED` ; le CDC
 *   §7.1 et les références disent `CHANGES_REQUIRED` : les deux codes
 *   désignent le même état et ont le même rendu ;
 * - « Nouvelle revue requise » (`REVIEW_REQUIRED`, T07) n'est pas dans la
 *   liste d'états du CDC §7.1 : état demandé par le PO, calculé par le
 *   serveur.
 */
export type MilestoneState =
  | 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CHANGES_REQUESTED' | 'RESUBMITTED'
  | 'TECHNICALLY_ACCEPTED' | 'REVIEW_REQUIRED';

export const MILESTONE_STATES: MilestoneState[] = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'RESUBMITTED', 'TECHNICALLY_ACCEPTED', 'REVIEW_REQUIRED',
];

const ALIASES: Record<string, MilestoneState> = { CHANGES_REQUIRED: 'CHANGES_REQUESTED' };

export const MILESTONE_STATE_LABELS: Record<MilestoneState, string> = {
  DRAFT: 'Brouillon',
  SUBMITTED: 'Soumis',
  UNDER_REVIEW: 'En examen',
  CHANGES_REQUESTED: 'Corrections demandées',
  RESUBMITTED: 'Resoumis',
  TECHNICALLY_ACCEPTED: 'Accepté techniquement',
  REVIEW_REQUIRED: 'Nouvelle revue requise',
};

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
  if ((MILESTONE_STATES as string[]).includes(code)) return code as MilestoneState;
  return ALIASES[code] ?? null;
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
