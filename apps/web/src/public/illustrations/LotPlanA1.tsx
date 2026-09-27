import {
  type PointerEvent as ReactPointerEvent, useCallback, useEffect, useId, useRef, useState,
} from 'react';

import {
  Button, Icon, brandColors, semanticColors,
} from '@keya/design-system';

/**
 * Plan indicatif du lot A1 (T3 fictif, 82,00 m² — jeu DEMO-CI-v1). Dessin
 * fourni par le PO (`docs/illustrations/plan-lot-a1.svg`, référence),
 * intégré en SVG EN LIGNE : couleurs = variables du thème, police héritée.
 *
 * Le plan est toujours posé sur une surface CLAIRE (`keya-light-surface` :
 * palette claire redéclarée localement), y compris en mode sombre — un plan
 * technique se lit sur fond clair. Vignette cliquable → visionneuse plein
 * écran : zoom à deux doigts, molette, double-clic ou boutons ; Échap ferme.
 */

const INK = semanticColors.neutral.heading;
const MUTED = semanticColors.neutral.textMuted;
const SURFACE = semanticColors.neutral.surface;
const STORAGE = semanticColors.neutral.background;
const PARQUET = semanticColors.accent.soft;
const PARQUET_LINE = semanticColors.neutral.textMuted;
const TILE_LINE = semanticColors.neutral.border;
const WET = semanticColors.neutral.subtle;
const WET_LINE = semanticColors.neutral.textMuted;
// Décision PO du 27/09 : doré réservé à la marque et à l'action principale.
const ENTRANCE = INK;

export const PLAN_CAPTION = 'Plan indicatif du lot A1 · T3 · 82,00 m² · surfaces fictives — programme fictif';

const MIN_SCALE = 1;
const MAX_SCALE = 6;

function PlanDrawing({ label }: { label: 'thumbnail' | 'viewer' }) {
  const uid = `${useId().replace(/:/g, '')}-${label}`;
  const ids = { parquet: `${uid}-parquet`, tile: `${uid}-tile`, wet: `${uid}-wet`, deck: `${uid}-deck` };
  return (
    <svg
      viewBox="0 0 698 659"
      role="img"
      aria-labelledby={`${uid}-title ${uid}-desc`}
      style={{ width: '100%', height: '100%', display: 'block', fontFamily: 'inherit' }}
    >
      <title id={`${uid}-title`}>Plan indicatif du lot A1 (programme fictif)</title>
      <desc id={`${uid}-desc`}>
        Plan coté d’un appartement T3 fictif de 82 m² : deux chambres, salle d’eau, WC, rangement, entrée, séjour,
        cuisine ouverte et balcon, avec surfaces par pièce et mobilier.
      </desc>
        <defs>
        <pattern id={ids.parquet} width={8} height={8} patternUnits="userSpaceOnUse">
        <rect width={8} height={8} style={{ fill: PARQUET }} />
        <line x1={0} y1={4} x2={8} y2={4} strokeWidth={0.5} strokeOpacity={0.3} style={{ stroke: PARQUET_LINE }} />
        </pattern>
        <pattern id={ids.tile} width={16} height={16} patternUnits="userSpaceOnUse">
        <rect width={16} height={16} style={{ fill: SURFACE }} />
        <path d="M16 0 H0 V16" fill="none" strokeWidth={0.6} style={{ stroke: TILE_LINE }} />
        </pattern>
        <pattern id={ids.wet} width={10} height={10} patternUnits="userSpaceOnUse">
        <rect width={10} height={10} style={{ fill: WET }} />
        <path d="M10 0 H0 V10" fill="none" strokeWidth={0.5} style={{ stroke: WET_LINE }} />
        </pattern>
        <pattern id={ids.deck} width={6} height={6} patternUnits="userSpaceOnUse">
        <circle cx={3} cy={3} r={0.7} fillOpacity={0.45} style={{ fill: MUTED }} />
        </pattern>
        </defs>
        <rect x={96} y={96} width={187.2} height={172.8} stroke="none" strokeWidth={0} style={{ fill: `url(#${ids.parquet})` }} />
        <rect x={360} y={96} width={168} height={172.8} stroke="none" strokeWidth={0} style={{ fill: `url(#${ids.parquet})` }} />
        <rect x={283.2} y={96} width={76.8} height={172.8} stroke="none" strokeWidth={0} style={{ fill: `url(#${ids.wet})` }} />
        <rect x={528} y={182.4} width={60} height={86.4} stroke="none" strokeWidth={0} style={{ fill: `url(#${ids.wet})` }} />
        <rect x={528} y={96} width={60} height={86.4} stroke="none" strokeWidth={0} style={{ fill: STORAGE }} />
        <rect x={96} y={268.8} width={492} height={211.2} stroke="none" strokeWidth={0} style={{ fill: `url(#${ids.tile})` }} />
        <rect x={144} y={483} width={240} height={67.2} stroke="none" strokeWidth={0} style={{ fill: `url(#${ids.deck})` }} />
        <line x1={96} y1={96} x2={144} y2={96} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={230.4} y1={96} x2={393.6} y2={96} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={475.2} y1={96} x2={588} y2={96} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={96} y1={480} x2={163.2} y2={480} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={364.8} y1={480} x2={470.4} y2={480} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={547.2} y1={480} x2={588} y2={480} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={96} y1={96} x2={96} y2={364.8} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={96} y1={441.6} x2={96} y2={480} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={588} y1={96} x2={588} y2={276} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={588} y1={319.2} x2={588} y2={480} strokeWidth={6} strokeLinecap="square" style={{ stroke: INK }} />
        <rect x={144} y={93} width={86.4} height={6} stroke="none" strokeWidth={0} style={{ fill: SURFACE }} />
        <line x1={144} y1={93} x2={230.4} y2={93} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={144} y1={96} x2={230.4} y2={96} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={144} y1={99} x2={230.4} y2={99} strokeWidth={0.8} style={{ stroke: INK }} />
        <rect x={393.6} y={93} width={81.6} height={6} stroke="none" strokeWidth={0} style={{ fill: SURFACE }} />
        <line x1={393.6} y1={93} x2={475.2} y2={93} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={393.6} y1={96} x2={475.2} y2={96} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={393.6} y1={99} x2={475.2} y2={99} strokeWidth={0.8} style={{ stroke: INK }} />
        <rect x={163.2} y={477} width={201.6} height={6} stroke="none" strokeWidth={0} style={{ fill: SURFACE }} />
        <line x1={163.2} y1={477} x2={364.8} y2={477} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={163.2} y1={480} x2={364.8} y2={480} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={163.2} y1={483} x2={364.8} y2={483} strokeWidth={0.8} style={{ stroke: INK }} />
        <rect x={470.4} y={477} width={76.8} height={6} stroke="none" strokeWidth={0} style={{ fill: SURFACE }} />
        <line x1={470.4} y1={477} x2={547.2} y2={477} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={470.4} y1={480} x2={547.2} y2={480} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={470.4} y1={483} x2={547.2} y2={483} strokeWidth={0.8} style={{ stroke: INK }} />
        <rect x={93} y={364.8} width={6} height={76.8} stroke="none" strokeWidth={0} style={{ fill: SURFACE }} />
        <line x1={93} y1={364.8} x2={93} y2={441.6} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={96} y1={364.8} x2={96} y2={441.6} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={99} y1={364.8} x2={99} y2={441.6} strokeWidth={0.8} style={{ stroke: INK }} />
        <line x1={96} y1={268.8} x2={240} y2={268.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={278.4} y1={268.8} x2={292.8} y2={268.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={326.4} y1={268.8} x2={364.8} y2={268.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={403.2} y1={268.8} x2={540} y2={268.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={573.6} y1={268.8} x2={588} y2={268.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={96} y1={326.4} x2={172.8} y2={326.4} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={403.2} y1={326.4} x2={460.8} y2={326.4} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={556.8} y1={326.4} x2={588} y2={326.4} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={283.2} y1={96} x2={283.2} y2={268.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={360} y1={96} x2={360} y2={268.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={528} y1={96} x2={528} y2={112.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={528} y1={160.8} x2={528} y2={268.8} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={528} y1={182.4} x2={588} y2={182.4} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={432} y1={326.4} x2={432} y2={393.6} strokeWidth={2.5} strokeLinecap="square" style={{ stroke: INK }} />
        <line x1={240} y1={268.8} x2={240} y2={230.4} strokeWidth={1} style={{ stroke: INK }} />
        <path d="M240.0 230.4 A 38.4 38.4 0 0 1 278.4 268.8" fill="none" strokeWidth={0.7} strokeDasharray="2 2" style={{ stroke: INK }} />
        <line x1={292.8} y1={268.8} x2={292.8} y2={235.2} strokeWidth={1} style={{ stroke: INK }} />
        <path d="M292.8 235.2 A 33.6 33.6 0 0 1 326.4 268.8" fill="none" strokeWidth={0.7} strokeDasharray="2 2" style={{ stroke: INK }} />
        <line x1={364.8} y1={268.8} x2={364.8} y2={230.4} strokeWidth={1} style={{ stroke: INK }} />
        <path d="M364.8 230.4 A 38.4 38.4 0 0 1 403.2 268.8" fill="none" strokeWidth={0.7} strokeDasharray="2 2" style={{ stroke: INK }} />
        <line x1={540} y1={263.8} x2={573.6} y2={263.8} strokeWidth={1.6} style={{ stroke: INK }} />
        <line x1={523} y1={112.8} x2={523} y2={160.8} strokeWidth={1.6} style={{ stroke: INK }} />
        <line x1={588} y1={276} x2={544.8} y2={276} strokeWidth={1.2} style={{ stroke: INK }} />
        <path d="M544.8 276.0 A 43.2 43.2 0 0 0 588.0 319.2" fill="none" strokeWidth={0.7} strokeDasharray="2 2" style={{ stroke: INK }} />
        <rect x={151.2} y={105.6} width={76.8} height={96} strokeWidth={0.9} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={156} y={110.4} width={31.2} height={19.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={192} y={110.4} width={31.2} height={19.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <line x1={151.2} y1={139.2} x2={228} y2={139.2} strokeWidth={0.7} strokeOpacity={0.6} style={{ stroke: INK }} />
        <rect x={127.2} y={108} width={20.2} height={20.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={231.8} y={108} width={20.2} height={20.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={410.4} y={105.6} width={67.2} height={96} strokeWidth={0.9} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={415.2} y={110.4} width={26.4} height={19.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={446.4} y={110.4} width={26.4} height={19.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <line x1={410.4} y1={139.2} x2={477.6} y2={139.2} strokeWidth={0.7} strokeOpacity={0.6} style={{ stroke: INK }} />
        <rect x={386.4} y={108} width={20.2} height={20.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={481.4} y={108} width={20.2} height={20.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={99.8} y={206.4} width={22.6} height={55.2} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={506.4} y={201.6} width={19.2} height={60} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={314.4} y={100.8} width={40.8} height={40.8} strokeWidth={0.9} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <line x1={314.4} y1={100.8} x2={355.2} y2={141.6} strokeWidth={0.6} style={{ stroke: INK }} />
        <line x1={355.2} y1={100.8} x2={314.4} y2={141.6} strokeWidth={0.6} style={{ stroke: INK }} />
        <rect x={288} y={146.4} width={21.6} height={28.8} strokeWidth={0.8} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <ellipse cx={297.6} cy={160.8} rx={6.2} ry={9.6} fill="none" strokeWidth={0.7} style={{ stroke: INK }} />
        <rect x={549.6} y={194.4} width={24} height={8.6} strokeWidth={0.8} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <ellipse cx={561.6} cy={216} rx={8.6} ry={12.5} strokeWidth={0.8} style={{ fill: SURFACE, stroke: INK }} />
        <line x1={578.4} y1={103.2} x2={578.4} y2={175.2} strokeWidth={0.9} strokeOpacity={0.6} style={{ stroke: INK }} />
        <line x1={571.2} y1={110.4} x2={585.6} y2={110.4} strokeWidth={0.6} strokeOpacity={0.45} style={{ stroke: INK }} />
        <line x1={571.2} y1={122.4} x2={585.6} y2={122.4} strokeWidth={0.6} strokeOpacity={0.45} style={{ stroke: INK }} />
        <line x1={571.2} y1={134.4} x2={585.6} y2={134.4} strokeWidth={0.6} strokeOpacity={0.45} style={{ stroke: INK }} />
        <line x1={571.2} y1={146.4} x2={585.6} y2={146.4} strokeWidth={0.6} strokeOpacity={0.45} style={{ stroke: INK }} />
        <line x1={571.2} y1={158.4} x2={585.6} y2={158.4} strokeWidth={0.6} strokeOpacity={0.45} style={{ stroke: INK }} />
        <line x1={571.2} y1={170.4} x2={585.6} y2={170.4} strokeWidth={0.6} strokeOpacity={0.45} style={{ stroke: INK }} />
        <rect x={112.8} y={410.4} width={124.8} height={38.4} strokeWidth={0.9} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={112.8} y={410.4} width={124.8} height={10.6} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={151.2} y={369.6} width={52.8} height={26.4} strokeWidth={0.7} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={297.6} y={362.4} width={76.8} height={43.2} strokeWidth={0.9} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={303.4} y={343.2} width={17.3} height={15.4} strokeWidth={0.6} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={303.4} y={409.4} width={17.3} height={15.4} strokeWidth={0.6} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={332.2} y={343.2} width={17.3} height={15.4} strokeWidth={0.6} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={332.2} y={409.4} width={17.3} height={15.4} strokeWidth={0.6} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={353.8} y={343.2} width={17.3} height={15.4} strokeWidth={0.6} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={353.8} y={409.4} width={17.3} height={15.4} strokeWidth={0.6} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <rect x={556.8} y={336} width={28.8} height={134.4} strokeWidth={0.9} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <circle cx={571.2} cy={369.6} r={7.7} fill="none" strokeWidth={0.7} style={{ stroke: INK }} />
        <circle cx={565.4} cy={422.4} r={3.8} fill="none" strokeWidth={0.6} style={{ stroke: INK }} />
        <circle cx={577} cy={422.4} r={3.8} fill="none" strokeWidth={0.6} style={{ stroke: INK }} />
        <circle cx={565.4} cy={436.8} r={3.8} fill="none" strokeWidth={0.6} style={{ stroke: INK }} />
        <circle cx={577} cy={436.8} r={3.8} fill="none" strokeWidth={0.6} style={{ stroke: INK }} />
        <rect x={470.4} y={374.4} width={57.6} height={33.6} strokeWidth={0.8} strokeOpacity={0.85} style={{ fill: SURFACE, stroke: INK }} />
        <text x={180} y={228} textAnchor="middle" style={{ fontSize: '12.5px', fontWeight: 600, fill: INK }}>Chambre 1</text>
        <text x={180} y={243} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>14,04 m²</text>
        <text x={448.8} y={228} textAnchor="middle" style={{ fontSize: '12.5px', fontWeight: 600, fill: INK }}>Chambre 2</text>
        <text x={448.8} y={243} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>12,60 m²</text>
        <text x={322.6} y={192} textAnchor="middle" style={{ fontSize: '11.5px', fontWeight: 600, fill: INK }}>Salle</text>
        <text x={322.6} y={206} textAnchor="middle" style={{ fontSize: '11.5px', fontWeight: 600, fill: INK }}>d’eau</text>
        <text x={322.6} y={221} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>5,76 m²</text>
        <text x={557.8} y={240} textAnchor="middle" style={{ fontSize: '11.5px', fontWeight: 600, fill: INK }}>WC</text>
        <text x={557.8} y={255} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>2,25 m²</text>
        <text x={552} y={141.6} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 600, fill: INK }}>Dressing</text>
        <text x={552} y={156.6} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>2,25 m²</text>
        <text x={249.6} y={293.8} textAnchor="middle" style={{ fontSize: '12.5px', fontWeight: 600, fill: INK }}>Entrée · dégagement</text>
        <text x={249.6} y={308.8} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>12,30 m²</text>
        <text x={331.2} y={448.8} textAnchor="middle" style={{ fontSize: '12.5px', fontWeight: 600, fill: INK }}>Séjour</text>
        <text x={331.2} y={463.8} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>22,40 m²</text>
        <text x={499.2} y={448.8} textAnchor="middle" style={{ fontSize: '12.5px', fontWeight: 600, fill: INK }}>Cuisine</text>
        <text x={499.2} y={463.8} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>10,40 m²</text>
        <text x={264} y={514.6} textAnchor="middle" style={{ fontSize: '12.5px', fontWeight: 600, fill: INK }}>Balcon</text>
        <text x={264} y={529.6} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>7,00 m² · hors surface</text>
        <path d="M618.0 297.6 l -14 0 m 5 -5 l -5 5 l 5 5" fill="none" strokeWidth={1.6} style={{ stroke: ENTRANCE }} />
        <text x={624} y={301.6} textAnchor="start" style={{ fontSize: '11px', fontWeight: 600, fill: ENTRANCE }}>Entrée</text>
        <line x1={96} y1={74} x2={588} y2={74} strokeWidth={0.7} style={{ stroke: MUTED }} />
        <line x1={92} y1={78} x2={100} y2={70} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={96} y1={68} x2={96} y2={80} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={279.2} y1={78} x2={287.2} y2={70} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={283.2} y1={68} x2={283.2} y2={80} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={356} y1={78} x2={364} y2={70} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={360} y1={68} x2={360} y2={80} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={524} y1={78} x2={532} y2={70} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={528} y1={68} x2={528} y2={80} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={584} y1={78} x2={592} y2={70} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={588} y1={68} x2={588} y2={80} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <text x={189.6} y={69} textAnchor="middle" style={{ fontSize: '10px', fontWeight: 400, fill: MUTED }}>3,90</text>
        <text x={321.6} y={69} textAnchor="middle" style={{ fontSize: '10px', fontWeight: 400, fill: MUTED }}>1,60</text>
        <text x={444} y={69} textAnchor="middle" style={{ fontSize: '10px', fontWeight: 400, fill: MUTED }}>3,50</text>
        <text x={558} y={69} textAnchor="middle" style={{ fontSize: '10px', fontWeight: 400, fill: MUTED }}>1,25</text>
        <line x1={96} y1={46} x2={588} y2={46} strokeWidth={0.7} style={{ stroke: MUTED }} />
        <line x1={92} y1={50} x2={100} y2={42} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={96} y1={40} x2={96} y2={52} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={584} y1={50} x2={592} y2={42} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={588} y1={40} x2={588} y2={52} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <text x={342} y={41} textAnchor="middle" style={{ fontSize: '10px', fontWeight: 400, fill: MUTED }}>10,25</text>
        <line x1={74} y1={96} x2={74} y2={480} strokeWidth={0.7} style={{ stroke: MUTED }} />
        <line x1={70} y1={100} x2={78} y2={92} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={68} y1={96} x2={80} y2={96} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={70} y1={272.8} x2={78} y2={264.8} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={68} y1={268.8} x2={80} y2={268.8} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={70} y1={330.4} x2={78} y2={322.4} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={68} y1={326.4} x2={80} y2={326.4} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={70} y1={484} x2={78} y2={476} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={68} y1={480} x2={80} y2={480} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <text x={68} y={182.4} textAnchor="middle" transform="rotate(-90 68 182.4)" style={{ fontSize: '10px', fill: MUTED }}>3,60</text>
        <text x={68} y={297.6} textAnchor="middle" transform="rotate(-90 68 297.6)" style={{ fontSize: '10px', fill: MUTED }}>1,20</text>
        <text x={68} y={403.2} textAnchor="middle" transform="rotate(-90 68 403.2)" style={{ fontSize: '10px', fill: MUTED }}>3,20</text>
        <line x1={46} y1={96} x2={46} y2={480} strokeWidth={0.7} style={{ stroke: MUTED }} />
        <line x1={42} y1={100} x2={50} y2={92} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={40} y1={96} x2={52} y2={96} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <line x1={42} y1={484} x2={50} y2={476} strokeWidth={1} style={{ stroke: MUTED }} />
        <line x1={40} y1={480} x2={52} y2={480} strokeWidth={0.5} style={{ stroke: MUTED }} />
        <text x={40} y={288} textAnchor="middle" transform="rotate(-90 40 288.0)" style={{ fontSize: '10px', fill: MUTED }}>8,00</text>
        <path d="M638.0 50 L645.0 74 L638.0 69 L631.0 74 Z" fill="none" strokeWidth={1.2} style={{ stroke: INK }} />
        <text x={638} y={90} textAnchor="middle" style={{ fontSize: '11px', fontWeight: 600, fill: INK }}>N</text>
        <line x1={96} y1={593.2} x2={336} y2={593.2} strokeWidth={1.2} style={{ stroke: INK }} />
        <line x1={96} y1={589.2} x2={96} y2={597.2} strokeWidth={1} style={{ stroke: INK }} />
        <line x1={144} y1={589.2} x2={144} y2={597.2} strokeWidth={1} style={{ stroke: INK }} />
        <line x1={192} y1={589.2} x2={192} y2={597.2} strokeWidth={1} style={{ stroke: INK }} />
        <line x1={240} y1={589.2} x2={240} y2={597.2} strokeWidth={1} style={{ stroke: INK }} />
        <line x1={288} y1={589.2} x2={288} y2={597.2} strokeWidth={1} style={{ stroke: INK }} />
        <line x1={336} y1={589.2} x2={336} y2={597.2} strokeWidth={1} style={{ stroke: INK }} />
        <text x={96} y={611.2} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>0</text>
        <text x={336} y={611.2} textAnchor="middle" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>5 m</text>
        <rect x={379.2} y={586.2} width={16} height={12} strokeWidth={0.6} style={{ fill: `url(#${ids.parquet})`, stroke: INK }} />
        <text x={401.2} y={596.2} textAnchor="start" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>Parquet</text>
        <rect x={475.2} y={586.2} width={16} height={12} strokeWidth={0.6} style={{ fill: `url(#${ids.tile})`, stroke: INK }} />
        <text x={497.2} y={596.2} textAnchor="start" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>Carrelage</text>
        <rect x={571.2} y={586.2} width={16} height={12} strokeWidth={0.6} style={{ fill: `url(#${ids.wet})`, stroke: INK }} />
        <text x={593.2} y={596.2} textAnchor="start" style={{ fontSize: '10.5px', fontWeight: 400, fill: MUTED }}>Pièces d’eau</text>
        <text x={96} y={639.2} textAnchor="start" style={{ fontSize: '12px', fontWeight: 400, fill: MUTED }}>Lot A1 · T3 · 82,00 m² habitables · plan indicatif, surfaces fictives — programme fictif</text>
    </svg>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface View { scale: number; x: number; y: number }

/** Zoom autour d'un point (coordonnées dans la fenêtre du plan), bornes incluses. */
function zoomAt(view: View, nextScale: number, pointX: number, pointY: number, width: number, height: number): View {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  const x = pointX - (pointX - view.x) * ratio;
  const y = pointY - (pointY - view.y) * ratio;
  return {
    scale,
    x: clamp(x, width * (1 - scale), 0),
    y: clamp(y, height * (1 - scale), 0),
  };
}

function PlanViewer({ onClose }: { onClose: () => void }) {
  const titleId = `${useId().replace(/:/g, '')}-viewer-title`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; distance: number; midX: number; midY: number; x: number; y: number } | null>(null);

  const size = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { left: rect?.left ?? 0, top: rect?.top ?? 0, width: rect?.width ?? 1, height: rect?.height ?? 1 };
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const { width, height } = size();
    setView((current) => zoomAt(current, current.scale * factor, width / 2, height / 2, width, height));
  }, [size]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-plan-close]')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const { left, top, width, height } = size();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((current) => zoomAt(current, current.scale * factor, event.clientX - left, event.clientY - top, width, height));
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [size]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === '+' || event.key === '=') zoomBy(1.25);
    if (event.key === '-') zoomBy(1 / 1.25);
    if (event.key === 'Tab' && dialogRef.current) {
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  function startGesture() {
    const points = Array.from(pointers.current.values());
    const { left, top } = size();
    if (points.length >= 2) {
      const [a, b] = points;
      gesture.current = {
        view, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, midX: (a.x + b.x) / 2 - left, midY: (a.y + b.y) / 2 - top, x: 0, y: 0,
      };
    } else if (points.length === 1) {
      gesture.current = { view, distance: 0, midX: 0, midY: 0, x: points[0].x, y: points[0].y };
    } else {
      gesture.current = null;
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(pointers.current.values());
    const { left, top, width, height } = size();
    const start = gesture.current;
    if (points.length >= 2) {
      const [a, b] = points;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2 - left;
      const midY = (a.y + b.y) / 2 - top;
      const zoomed = zoomAt(start.view, start.view.scale * (distance / start.distance), start.midX, start.midY, width, height);
      setView({
        scale: zoomed.scale,
        x: clamp(zoomed.x + (midX - start.midX), width * (1 - zoomed.scale), 0),
        y: clamp(zoomed.y + (midY - start.midY), height * (1 - zoomed.scale), 0),
      });
    } else if (start.view.scale > 1) {
      setView({
        scale: start.view.scale,
        x: clamp(start.view.x + (points[0].x - start.x), width * (1 - start.view.scale), 0),
        y: clamp(start.view.y + (points[0].y - start.y), height * (1 - start.view.scale), 0),
      });
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    startGesture();
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const { left, top, width, height } = size();
    setView((current) => zoomAt(current, current.scale > 1 ? 1 : 2.5, event.clientX - left, event.clientY - top, width, height));
  }

  const percent = Math.round(view.scale * 100);
  // Barre d'outils sur fond navy fixe : boutons secondaires sur la surface
  // du thème (lisibles en clair comme en sombre).
  const toolStyle = { background: semanticColors.neutral.surface, color: semanticColors.neutral.heading, minWidth: '44px' };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="plan-viewer"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column',
        background: brandColors.navy, color: '#FFFFFF',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', flexWrap: 'wrap' }}>
        <h2 id={titleId} style={{ margin: 0, fontSize: '16px', color: 'inherit', flex: '1 1 160px' }}>Plan du lot A1 (programme fictif)</h2>
        <span aria-live="polite" style={{ fontSize: '14px', minWidth: '48px', textAlign: 'right' }}>{`${percent} %`}</span>
        <Button type="button" variant="secondary" style={toolStyle} onClick={() => zoomBy(1 / 1.25)} disabled={view.scale <= MIN_SCALE} aria-label="Dézoomer">−</Button>
        <Button type="button" variant="secondary" style={toolStyle} onClick={() => zoomBy(1.25)} disabled={view.scale >= MAX_SCALE} aria-label="Zoomer">+</Button>
        <Button type="button" variant="secondary" style={toolStyle} onClick={() => setView({ scale: 1, x: 0, y: 0 })} disabled={view.scale === 1}>Ajuster</Button>
        <Button data-plan-close type="button" variant="accent" onClick={onClose}>Fermer</Button>
      </div>
      <div
        ref={viewportRef}
        data-testid="plan-viewport"
        className="keya-light-surface"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={handleDoubleClick}
        style={{
          flex: '1 1 auto', margin: '0 12px 12px', borderRadius: '6px', overflow: 'hidden', touchAction: 'none',
          background: semanticColors.neutral.surface, cursor: view.scale > 1 ? 'grab' : 'zoom-in', userSelect: 'none',
        }}
      >
        <div
          style={{
            width: '100%', height: '100%', transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <PlanDrawing label="viewer" />
        </div>
      </div>
      <p style={{ margin: '0 12px 12px', fontSize: '13px', color: 'rgba(255, 255, 255, 0.8)' }}>
        Pincez pour zoomer, faites glisser pour vous déplacer. {PLAN_CAPTION}
      </p>
    </div>
  );
}

export function LotPlanA1() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <figure
      data-testid="lot-plan-a1"
      style={{
        margin: 0, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '14px',
        padding: 'clamp(16px, 3vw, 24px)', borderRadius: '6px', background: semanticColors.neutral.surface,
        border: `1px solid ${semanticColors.neutral.border}`,
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Agrandir le plan du lot A1 (programme fictif)"
        aria-haspopup="dialog"
        className="keya-light-surface"
        style={{
          position: 'relative', display: 'block', width: '100%', aspectRatio: '698 / 659', padding: '8px', borderRadius: '6px',
          border: `1px solid ${semanticColors.neutral.border}`, background: semanticColors.neutral.surface, cursor: 'zoom-in',
        }}
      >
        <span aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }}>
          <PlanDrawing label="thumbnail" />
        </span>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', right: '10px', bottom: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '6px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: 700,
            background: semanticColors.primary.background, color: semanticColors.primary.text,
          }}
        >
          <Icon name="search" size={14} />
          Agrandir
        </span>
      </button>
      <figcaption style={{ fontSize: '15px', color: semanticColors.neutral.textMuted }}>{PLAN_CAPTION}</figcaption>
      {open && <PlanViewer onClose={close} />}
    </figure>
  );
}
