import { useId } from 'react';

import {
  type MilestoneAudience, type MilestoneState, milestoneStateLabel, reportUnknownMilestoneState, resolveMilestoneState,
} from '../MilestoneGauge/milestoneStates';
import { FACADE_DRAWING, FACADE_MARKERS, FACADE_VIEWBOX } from './facadeDrawing';

/**
 * PO-2026-09-28-28 — façade-jauge (référence
 * `docs/design/references/facade-jauge-reference.html`). Le dessin de la
 * résidence fictive est découpé en groupes `data-jalon="fondations"` et
 * `data-jalon="elevation"` ; l'état de chaque groupe s'applique par une
 * classe CSS, avec les mêmes états que `MilestoneGauge` :
 *
 * - Brouillon : fantôme gris en pointillés, sans remplissage ;
 * - Soumis et Resoumis : trait Information ;
 * - En examen : trait Information et fond rayé ;
 * - Corrections demandées : trait Attention en tirets et fond hachuré ;
 * - Accepté techniquement : trait plein à l'encre ;
 * - Nouvelle revue nécessaire : trait à l'encre, contour Succès pointillé.
 *
 * Règle clé : une partie n'est tracée en trait plein que si son jalon est
 * accepté techniquement. Couleurs par variables du thème ; le dessin est
 * posé sur une surface CLAIRE (`keya-light-surface`) même en mode sombre.
 * Le SVG porte un libellé décrivant l'état de chaque partie ; la liste des
 * jalons, à côté, fait foi (la couleur n'est jamais seule porteuse). Un état
 * inconnu est une erreur visible, jamais « accepté » par défaut.
 */
export type FacadePart = 'fondations' | 'elevation';

export const FACADE_PARTS: { key: FacadePart; label: string }[] = [
  { key: 'fondations', label: 'Fondations' },
  { key: 'elevation', label: 'Élévation' },
];

const CLASS: Record<MilestoneState, string> = {
  DRAFT: 'draft',
  SUBMITTED: 'sub',
  RESUBMITTED: 'sub',
  UNDER_REVIEW: 'review',
  CHANGES_REQUESTED: 'changes',
  TECHNICALLY_ACCEPTED: 'ok',
  REVIEW_REQUIRED: 'stale',
};

function css(scope: string, uid: string) {
  const s = `[data-facade-uid="${uid}"]`;
  return `
${s} line, ${s} rect, ${s} path { fill: none; stroke: currentColor; vector-effect: non-scaling-stroke; }
${s} .ground { color: var(--keya-neutral-text-muted); } ${s} .ground .k { stroke-width: 1.4; } ${s} .ground .t { stroke-width: .7; opacity: .5; }
${s} .outline { stroke-width: 1.8; } ${s} .d { stroke-width: 1.1; } ${s} .t { stroke-width: .7; opacity: .7; }
${s} .wood { stroke-width: .6; opacity: .45; } ${s} .glass { stroke-width: .8; opacity: .7; }
${s} .frame { stroke-width: 7; } ${s} .fillw { fill: var(--keya-neutral-surface); } ${s} .bg { stroke: none; }
${s} .st-draft { color: var(--keya-neutral-text-muted); opacity: .6; }
${s} .st-draft line, ${s} .st-draft rect, ${s} .st-draft path { stroke-dasharray: 3 4; }
${s} .st-draft .frame { stroke-width: 2; } ${s} .st-draft .wood, ${s} .st-draft .t { opacity: .35; } ${s} .st-draft .fillw { fill: none; }
${s} .st-sub { color: var(--keya-info-text); }
${s} .st-review { color: var(--keya-info-text); } ${s} .st-review .bg { fill: url(#h-info-${scope}); }
${s} .st-changes { color: var(--keya-alert-text); } ${s} .st-changes .bg { fill: url(#h-warn-${scope}); }
${s} .st-changes .outline, ${s} .st-changes .d { stroke-dasharray: 6 4; }
${s} .st-ok { color: var(--keya-neutral-heading); }
${s} .st-stale { color: var(--keya-neutral-heading); } ${s} .st-stale .outline { stroke: var(--keya-success-text); stroke-dasharray: 5 4; }
${s} .st-unknown { color: var(--keya-danger-border); } ${s} .st-unknown line, ${s} .st-unknown rect, ${s} .st-unknown path { stroke-dasharray: 2 2; }
${s} .mk circle { fill: var(--keya-neutral-surface); stroke: currentColor; stroke-width: 1.4; }
${s} .mk text { font: 600 10px ui-monospace, monospace; fill: currentColor; stroke: none; text-anchor: middle; }
${s} .mk .br { stroke: currentColor; stroke-width: 1.2; }
${s} .mk.st-ok, ${s} .mk.st-stale { color: var(--keya-success-text); }
${s} .mk.st-draft { color: var(--keya-neutral-text-muted); } ${s} .mk.st-draft .br { stroke-dasharray: none; }
`;
}

export interface FacadeGaugeProps {
  /** `cdc_state` du serveur pour chaque partie du dessin. */
  states: Record<FacadePart, string>;
  /** Repères numérotés 01 / 02 (espace client) ; masqués dans la frise. */
  markers?: boolean;
  /** Libellés des jalons (par défaut « Fondations », « Élévation »). */
  labels?: Partial<Record<FacadePart, string>>;
  /** PO-2026-09-28-31 : « Pas encore déclaré » pour le client et la page publique. */
  audience?: MilestoneAudience;
}

export function facadeAccessibleLabel(
  states: Record<FacadePart, string>, labels: Partial<Record<FacadePart, string>> = {}, audience: MilestoneAudience = 'workspace',
) {
  const parts = FACADE_PARTS.map(({ key, label }) => {
    const state = resolveMilestoneState(states[key]);
    const status = state ? milestoneStateLabel(state, audience).toLowerCase() : `état inconnu (${states[key]})`;
    return `${(labels[key] ?? label).toLowerCase()} ${status}`;
  });
  return `Façade de la résidence : ${parts.join(', ')}`;
}

export function FacadeGauge({ states, markers = true, labels = {}, audience = 'workspace' }: FacadeGaugeProps) {
  const scope = useId().replace(/[^a-zA-Z0-9]/g, '');
  const cls = (part: FacadePart) => {
    const state = resolveMilestoneState(states[part]);
    if (!state) reportUnknownMilestoneState(states[part]);
    return state ? CLASS[state] : 'unknown';
  };
  const fill = (markup: string) => markup
    .replace('__FONDATIONS__', cls('fondations')).replace('__FONDATIONS__', cls('fondations'))
    .replace('__ELEVATION__', cls('elevation')).replace('__ELEVATION__', cls('elevation'));
  const defs = `<defs>
<pattern id="h-warn-${scope}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" style="fill:var(--keya-alert-background);stroke:none"/><line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--keya-alert-text);stroke-width:1.6;stroke-opacity:.35"/></pattern>
<pattern id="h-info-${scope}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" style="fill:var(--keya-info-background);stroke:none"/><line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--keya-info-text);stroke-width:1.4;stroke-opacity:.3"/></pattern>
</defs>`;
  return (
    <div
      className="keya-light-surface"
      data-facade-uid={scope}
      data-testid="facade-gauge"
      style={{ display: 'flex', background: 'var(--keya-neutral-surface)', borderRadius: '4px' }}
    >
      <style>{css(scope, scope)}</style>
      <svg
        viewBox={FACADE_VIEWBOX}
        role="img"
        aria-label={facadeAccessibleLabel(states, labels, audience)}
        style={{ display: 'block', flex: '1 1 auto', minWidth: 0, height: 'auto' }}
        // Dessin STATIQUE du dépôt (référence du PO), jamais une donnée
        // saisie : seuls les noms de classe d'état y sont substitués.
        dangerouslySetInnerHTML={{ __html: defs + fill(FACADE_DRAWING) + (markers ? fill(FACADE_MARKERS) : '') }}
      />
    </div>
  );
}
