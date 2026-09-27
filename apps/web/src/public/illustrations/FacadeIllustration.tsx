import { useId } from 'react';

import { semanticColors, useIsMobile } from '@keya/design-system';

/**
 * Façade de la « Résidence Démonstration Abidjan » (programme FICTIF, jeu
 * DEMO-CI-v1) et ses deux jalons (CDC R1 §9.1 : « Fondations »,
 * « Élévation »). Dessin fourni par le PO, redessiné en SVG EN LIGNE : les
 * couleurs sont les variables du thème (`var(--keya-*)`, clair et sombre),
 * les textes héritent de la police du site.
 *
 * Sous 640 px, les libellés dessinés deviendraient illisibles (dessin réduit
 * à ~25 %) : ils sont remplacés par des repères numérotés et une légende
 * HTML. La mention « programme fictif » est TOUJOURS visible, en texte réel
 * (légende de la figure), jamais seulement dans le dessin. Le dessin est
 * posé sur la surface du thème (carte), dont il reprend la couleur pour
 * masquer le parement de briques derrière portes et fenêtres.
 */

const INK = semanticColors.neutral.heading;
const FINE = semanticColors.neutral.textMuted;
const BRICK = semanticColors.neutral.border;
const MILESTONE_1 = semanticColors.accent.text;

export const FACADE_CAPTION = 'Illustration — Résidence Démonstration Abidjan · programme fictif, sans valeur contractuelle';

const FLOORS_RIGHT = [114, 234, 354, 474];
const FOUNDATION_POSTS = [333, 513, 693, 793, 1023, 1253];

function range(start: number, end: number, step: number) {
  const values: number[] = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

function Scallops({ from, to }: { from: number; to: number }) {
  const bumps = range(from, to - 14, 14);
  const d = bumps.map((x) => `M${x} 86 q7 -12 14 0`).join(' ');
  return <path d={d} fill="none" strokeWidth={2} />;
}

function Window({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="none" strokeWidth={2.5} />
      <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height} strokeWidth={1.5} />
    </g>
  );
}

/** Garde-corps vitré : cadre fin et reflets en diagonale. */
function Glass({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return (
    <g style={{ stroke: FINE }}>
      <rect x={x} y={y} width={width} height={height} fill="none" strokeWidth={1.2} />
      {range(x + 30, x + width - 20, 58).map((glintX) => (
        <line key={glintX} x1={glintX} y1={y + 8} x2={glintX + 14} y2={y + height - 10} strokeWidth={1.2} />
      ))}
    </g>
  );
}

function Planter({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={678} width={60} height={24} fill="none" strokeWidth={2} />
      <path d={`M${x + 8} 678 q6 -18 12 0 q6 -18 12 0 q6 -18 12 0 q6 -18 12 0`} fill="none" strokeWidth={1.6} />
    </g>
  );
}

function MarkerBubble({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={34} style={{ fill: INK, stroke: 'none' }} />
      <text
        x={x}
        y={y + 15}
        textAnchor="middle"
        style={{ fill: semanticColors.neutral.surface, stroke: 'none', fontSize: '42px', fontWeight: 700 }}
      >
        {label}
      </text>
    </g>
  );
}

export function FacadeIllustration() {
  const isMobile = useIsMobile();
  const uid = useId().replace(/:/g, '');
  const brickId = `facade-brick-${uid}`;
  const titleId = `facade-title-${uid}`;
  const descId = `facade-desc-${uid}`;

  return (
    <figure
      data-testid="facade-illustration"
      style={{
        margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: 'clamp(16px, 3vw, 32px)', borderRadius: '24px',
        background: semanticColors.neutral.surface, border: `1px solid ${semanticColors.neutral.border}`,
      }}
    >
      <svg
        viewBox={isMobile ? '80 20 1300 800' : '80 20 1440 850'}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        style={{ width: '100%', height: 'auto', display: 'block', fontFamily: 'inherit' }}
      >
        <title id={titleId}>Façade de la Résidence Démonstration Abidjan (programme fictif)</title>
        <desc id={descId}>
          Immeuble de quatre niveaux. Jalon 1, Fondations : sous le niveau du sol. Jalon 2, Élévation : du sol à la toiture.
        </desc>
        <defs>
          <pattern id={brickId} width={36} height={16} patternUnits="userSpaceOnUse">
            <g style={{ stroke: BRICK }} strokeWidth={1.4} fill="none">
              <rect x={1} y={1} width={16} height={6} />
              <rect x={19} y={1} width={16} height={6} />
              <rect x={10} y={9} width={16} height={6} />
            </g>
          </pattern>
        </defs>

        <g style={{ stroke: INK }} strokeLinecap="square">
          {/* Sol et hachures */}
          <line x1={93} y1={702} x2={1493} y2={702} strokeWidth={3} />
          <g style={{ stroke: FINE }} strokeWidth={1.4}>
            {range(92, 1470, 28).map((x) => <line key={x} x1={x} y1={720} x2={x + 16} y2={705} />)}
          </g>

          {/* Palmier et bacs */}
          <g style={{ stroke: FINE }} strokeWidth={2.2} fill="none">
            <line x1={209} y1={702} x2={209} y2={420} style={{ stroke: INK }} />
            <path d="M209 420 Q170 372 142 386" />
            <path d="M209 420 Q180 404 158 434" />
            <path d="M209 420 Q240 368 268 380" />
            <path d="M209 420 Q238 410 257 438" />
            <path d="M209 420 Q198 380 200 350" />
            <path d="M209 420 Q214 385 216 356" />
          </g>
          <Planter x={253} />
          <Planter x={1265} />

          {/* Bloc gauche */}
          <rect x={323} y={86} width={380} height={16} fill="none" strokeWidth={3} />
          <Scallops from={335} to={690} />
          <rect x={333} y={102} width={360} height={600} fill="none" strokeWidth={3} />
          <rect x={352} y={118} width={322} height={220} fill="none" strokeWidth={12} />
          <g style={{ stroke: FINE }} strokeWidth={1}>
            {range(364, 662, 7).map((x) => <line key={x} x1={x} y1={126} x2={x} y2={330} />)}
          </g>
          <rect x={425} y={134} width={176} height={76} style={{ fill: semanticColors.neutral.surface }} strokeWidth={2.5} />
          <line x1={513} y1={134} x2={513} y2={210} strokeWidth={1.5} />
          <rect x={425} y={250} width={176} height={76} style={{ fill: semanticColors.neutral.surface }} strokeWidth={2.5} />
          <line x1={513} y1={250} x2={513} y2={326} strokeWidth={1.5} />
          <Glass x={365} y={178} width={296} height={44} />
          <line x1={362} y1={221} x2={664} y2={221} strokeWidth={3} />
          <Glass x={365} y={294} width={296} height={38} />
          <line x1={333} y1={342} x2={693} y2={342} strokeWidth={2.5} />
          <Window x={377} y={366} width={112} height={76} />
          <Window x={537} y={366} width={112} height={76} />
          <line x1={333} y1={462} x2={693} y2={462} strokeWidth={2.5} />
          <Window x={377} y={486} width={112} height={76} />
          <Window x={537} y={486} width={112} height={76} />
          <rect x={335} y={584} width={356} height={117} style={{ fill: `url(#${brickId})`, stroke: 'none' }} />
          <line x1={333} y1={582} x2={693} y2={582} strokeWidth={2.5} />
          <rect x={385} y={613} width={112} height={89} style={{ fill: semanticColors.neutral.surface }} strokeWidth={2.5} />
          <line x1={441} y1={613} x2={441} y2={702} strokeWidth={1.5} />
          <rect x={541} y={622} width={100} height={60} style={{ fill: semanticColors.neutral.surface }} strokeWidth={2.5} />
          <line x1={591} y1={622} x2={591} y2={682} strokeWidth={1.5} />

          {/* Cage d'escalier */}
          <rect x={693} y={38} width={100} height={548} fill="none" strokeWidth={4} />
          <rect x={709} y={58} width={68} height={500} fill="none" strokeWidth={1.8} />
          <g strokeWidth={1.2} style={{ stroke: FINE }}>
            {range(98, 538, 40).map((y) => <line key={y} x1={709} y1={y} x2={777} y2={y} />)}
          </g>
          <line x1={693} y1={586} x2={693} y2={702} strokeWidth={3} />
          <line x1={793} y1={586} x2={793} y2={702} strokeWidth={3} />
          <rect x={715} y={598} width={56} height={104} fill="none" strokeWidth={2.5} />
          <line x1={743} y1={598} x2={743} y2={702} strokeWidth={1.5} />

          {/* Bloc droit */}
          <rect x={783} y={86} width={480} height={16} fill="none" strokeWidth={3} />
          <Scallops from={797} to={1255} />
          <rect x={793} y={102} width={460} height={600} fill="none" strokeWidth={3} />
          <g style={{ stroke: FINE }} strokeWidth={1.2}>
            {range(1177, 1241, 7).map((x) => <line key={x} x1={x} y1={230} x2={x} y2={568} />)}
          </g>
          <line x1={1173} y1={230} x2={1245} y2={230} strokeWidth={2.5} />
          <line x1={1173} y1={569} x2={1245} y2={569} strokeWidth={2.5} />
          {FLOORS_RIGHT.map((y) => (
            <g key={y}>
              <Window x={833} y={y} width={128} height={80} />
              <Window x={1005} y={y} width={128} height={80} />
              <Glass x={785} y={y + 58} width={496} height={44} />
              <rect x={781} y={y + 102} width={504} height={11} style={{ fill: semanticColors.neutral.surface }} strokeWidth={3} />
            </g>
          ))}
          <rect x={795} y={590} width={456} height={111} style={{ fill: `url(#${brickId})`, stroke: 'none' }} />
          <rect x={829} y={605} width={168} height={97} style={{ fill: semanticColors.neutral.surface }} strokeWidth={2.5} />
          {[871, 913, 955].map((x) => <line key={x} x1={x} y1={605} x2={x} y2={702} strokeWidth={1.5} />)}
          <rect x={1057} y={622} width={112} height={60} style={{ fill: semanticColors.neutral.surface }} strokeWidth={2.5} />
          <line x1={1113} y1={622} x2={1113} y2={682} strokeWidth={1.5} />
        </g>

        {/* Jalon 1 — fondations, sous le niveau du sol */}
        <g style={{ stroke: MILESTONE_1 }} strokeWidth={2.4} strokeDasharray="8 6" fill="none">
          <line x1={293} y1={726} x2={1293} y2={726} />
          {FOUNDATION_POSTS.map((x) => (
            <g key={x}>
              <line x1={x} y1={704} x2={x} y2={745} />
              <rect x={x - 33} y={745} width={66} height={28} />
            </g>
          ))}
        </g>

        {/* Jalon 2 — élévation, du sol à la toiture */}
        <path d="M1320 38 H1327 V700 H1320" fill="none" style={{ stroke: FINE }} strokeWidth={2} />

        {isMobile ? (
          <g aria-hidden="true">
            <MarkerBubble x={240} y={768} label="1" />
            <MarkerBubble x={1327} y={370} label="2" />
          </g>
        ) : (
          <g aria-hidden="true" style={{ stroke: 'none' }}>
            <text x={281} y={813} style={{ fill: MILESTONE_1, fontSize: '24px', fontWeight: 700 }}>Jalon 1 · Fondations</text>
            <text x={281} y={847} style={{ fill: FINE, fontSize: '21px' }}>sous le niveau du sol</text>
            <text x={1349} y={362} style={{ fill: INK, fontSize: '24px', fontWeight: 700 }}>Jalon 2</text>
            <text x={1349} y={395} style={{ fill: INK, fontSize: '22px' }}>Élévation</text>
          </g>
        )}
      </svg>

      {isMobile && (
        <ol
          data-testid="facade-legend"
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '15px' }}
        >
          {[
            ['1', 'Jalon 1 · Fondations', 'sous le niveau du sol'],
            ['2', 'Jalon 2 · Élévation', 'du sol à la toiture'],
          ].map(([number, label, detail]) => (
            <li key={number} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                aria-hidden="true"
                style={{
                  width: '26px', height: '26px', flexShrink: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', background: INK, color: semanticColors.neutral.surface, fontWeight: 700, fontSize: '14px',
                }}
              >
                {number}
              </span>
              <span>
                <strong style={{ color: number === '1' ? MILESTONE_1 : INK }}>{label}</strong>
                <span style={{ color: FINE }}>{` — ${detail}`}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <figcaption style={{ fontSize: '15px', color: FINE }}>{FACADE_CAPTION}</figcaption>
    </figure>
  );
}
