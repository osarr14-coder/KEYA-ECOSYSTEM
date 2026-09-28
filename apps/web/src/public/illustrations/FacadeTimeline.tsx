import { FacadeGauge, type FacadePart, semanticColors } from '@keya/design-system';

/**
 * PO-2026-09-28-28 (D3) — frise « La façade au fil du scénario » (référence
 * `docs/design/references/facade-jauge-reference.html`, section 2), pour la
 * section « Comment ça marche » de la page publique.
 *
 * Les états sont FIGÉS ici : la frise est une illustration, elle ne lit
 * aucune donnée de dossier ni aucun appel d'API. Elle porte la mention
 * « illustration — programme fictif ». Textes repris de la référence.
 * PO-2026-09-28-32 : repères « 1 · Déclaration » … « 4 · Jalon suivant » ;
 * PO-2026-09-28-31 : brouillon lu « pas encore déclaré ».
 */
export const FACADE_TIMELINE_NOTE = 'illustration — programme fictif';

export const FACADE_TIMELINE_STEPS: {
  key: string; stage: string; title: string; text: string; states: Record<FacadePart, string>;
}[] = [
  {
    key: 'review',
    stage: '1 · Déclaration',
    title: 'Fondations en examen',
    text: 'Le constructeur a déclaré les fondations et déposé ses pièces. Le contrôleur examine.',
    states: { fondations: 'UNDER_REVIEW', elevation: 'DRAFT' },
  },
  {
    key: 'reserve',
    stage: '2 · Réserve',
    title: 'Réserve ouverte',
    text: 'Le contrôleur demande une reprise. Le dessin reste en pointillés : rien n’est acquis.',
    states: { fondations: 'CHANGES_REQUESTED', elevation: 'DRAFT' },
  },
  {
    key: 'accepted',
    stage: '3 · Acceptation',
    title: 'Fondations acceptées',
    text: 'Après correction et recontrôle, les fondations sont dessinées. Le décaissement devient possible.',
    states: { fondations: 'TECHNICALLY_ACCEPTED', elevation: 'DRAFT' },
  },
  {
    key: 'next',
    stage: '4 · Jalon suivant',
    title: 'Élévation en examen',
    text: 'Le constructeur déclare l’élévation. Le même cycle recommence.',
    states: { fondations: 'TECHNICALLY_ACCEPTED', elevation: 'UNDER_REVIEW' },
  },
];

export function FacadeTimeline() {
  return (
    <figure data-testid="facade-timeline" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <ol
        aria-label="La façade au fil du chantier"
        style={{
          listStyle: 'none', margin: 0, padding: 0, display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '1px',
          background: semanticColors.neutral.border, border: `1px solid ${semanticColors.neutral.border}`,
          borderRadius: '6px', overflow: 'hidden',
        }}
      >
        {FACADE_TIMELINE_STEPS.map((step) => (
          <li
            key={step.key}
            data-testid="facade-timeline-step"
            style={{ background: semanticColors.neutral.surface, padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <div style={{ background: semanticColors.neutral.subtle, borderRadius: '4px', padding: '10px 4px 4px' }}>
              <FacadeGauge states={step.states} markers={false} audience="client" />
            </div>
            <span style={{ fontSize: '11px', fontWeight: 500, color: semanticColors.neutral.textMuted, fontFamily: 'ui-monospace, monospace' }}>
              {step.stage}
            </span>
            <h3 style={{ margin: 0, fontSize: '15px', color: semanticColors.neutral.heading }}>{step.title}</h3>
            <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>{step.text}</p>
          </li>
        ))}
      </ol>
      <figcaption style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        {FACADE_TIMELINE_NOTE.charAt(0).toUpperCase() + FACADE_TIMELINE_NOTE.slice(1)}
        {' : états figés, aucune donnée d’un dossier réel. Une partie n’est dessinée en trait plein qu’une fois son jalon accepté techniquement.'}
      </figcaption>
    </figure>
  );
}
