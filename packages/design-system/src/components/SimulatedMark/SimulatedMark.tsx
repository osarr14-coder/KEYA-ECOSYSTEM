import type { CSSProperties } from 'react';

import { SIMULATION_MARKING } from '../../copy/demoCopy';
import { semanticColors } from '../../tokens/colors';

/**
 * Audit UI R1 (M03, M04) — marqueur UNIQUE des actes et paiements simulés
 * (CDC R1 §3.1) : « SIMULÉ — SANS VALEUR OPÉRATIONNELLE », accolé à chaque
 * acte (signature, virement, encaissement, rapprochement, décaissement).
 *
 * Style dédié, même grammaire que le bandeau de démonstration : hachures et
 * texte à l'encre du thème. Ni doré (réservé à la marque et à l'action
 * principale) ni couleur de statut, pour ne jamais se lire comme un décor ou
 * comme un état.
 *
 * `detail` précise l'acte simulé (« Virement », « Signature »…), placé
 * après le marquage, jamais à sa place.
 */
export interface SimulatedMarkProps {
  detail?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

export function SimulatedMark({ detail, style, 'data-testid': testId = 'simulated-mark' }: SimulatedMarkProps) {
  const text = detail ? `${SIMULATION_MARKING} · ${detail}` : SIMULATION_MARKING;
  return (
    <span
      role="note"
      data-testid={testId}
      style={{
        display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', boxSizing: 'border-box',
        padding: '3px 8px', borderRadius: '4px',
        border: `1px solid ${semanticColors.neutral.heading}`,
        color: semanticColors.neutral.heading,
        background: `repeating-linear-gradient(-45deg, transparent 0 6px, rgba(128, 128, 128, 0.16) 6px 12px), ${semanticColors.neutral.surface}`,
        fontSize: '11px', fontWeight: 800, letterSpacing: '0.05em', lineHeight: 1.3, overflowWrap: 'anywhere',
        ...style,
      }}
    >
      {text}
    </span>
  );
}
