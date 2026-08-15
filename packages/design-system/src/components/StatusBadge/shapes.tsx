/**
 * Une forme SVG distincte par niveau Visible Trust — c'est CE QUI rend le
 * badge distinguable en niveaux de gris (ticket 007, critère d'acceptation) :
 * la géométrie du path diffère réellement d'un niveau à l'autre, ce n'est pas
 * qu'une étiquette `data-shape` posée à côté d'icônes identiques. La couleur
 * (voir `levelMeta.ts`) reste un renfort, jamais le seul signal.
 */

import type { TrustLevel } from './levelMeta';

interface ShapeIconProps {
  shape: TrustShape;
  size?: number;
}

export type TrustShape = 'ring' | 'square' | 'triangle' | 'diamond' | 'star';

export const SHAPE_BY_LEVEL: Record<TrustLevel, TrustShape> = {
  declare: 'ring',
  documente: 'square',
  controle: 'triangle',
  verifie: 'diamond',
  valide: 'star',
};

const SHAPE_PATHS: Record<TrustShape, string> = {
  // Anneau : cercle non rempli — la moins « construite » des formes.
  ring: 'M8 2a6 6 0 1 0 0.001 0 M8 4.4a3.6 3.6 0 1 1 -0.001 0',
  square: 'M2.5 2.5h11v11h-11z',
  triangle: 'M8 1.5 14.5 13.5h-13z',
  diamond: 'M8 1 15 8 8 15 1 8z',
  star: 'M8 1 9.85 5.87 15 6.27 11 9.62 12.35 14.73 8 11.9 3.65 14.73 5 9.62 1 6.27 6.15 5.87z',
};

export function ShapeIcon({ shape, size = 16 }: ShapeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      data-shape={shape}
    >
      <path d={SHAPE_PATHS[shape]} fillRule="evenodd" />
    </svg>
  );
}
