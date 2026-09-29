import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §10, CDC §9.3) : indicateur traçable —
 * numérateur et dénominateur toujours visibles, chiffre cliquable jusqu'à
 * ses sources. Dénominateur nul → « Non applicable », jamais « 100 % ».
 */
export interface IndicatorProps {
  label: string;
  numerator: number;
  denominator: number;
  /** Ce que compte le dénominateur (« jalons déclarés »). */
  unit: string;
  onOpenSources?: () => void;
  /** Précision sous le ratio (« Présence d’une pièce, pas sa conformité »). */
  note?: string;
  'data-testid'?: string;
}

export function indicatorValue(numerator: number, denominator: number): string {
  if (denominator === 0) return 'Non applicable';
  return `${Math.round((numerator / denominator) * 100).toLocaleString('fr-FR')} %`;
}

export function Indicator({
  label, numerator, denominator, unit, onOpenSources, note, 'data-testid': testId,
}: IndicatorProps) {
  const value = indicatorValue(numerator, denominator);
  const body = (
    <>
      <span style={{ fontSize: '13px', fontWeight: 600, color: semanticColors.neutral.textMuted }}>{label}</span>
      <span
        data-testid={testId ? `${testId}-value` : undefined}
        style={{
          fontSize: denominator === 0 ? '16px' : '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: denominator === 0 ? semanticColors.neutral.textMuted : semanticColors.neutral.heading,
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>{`${numerator} / ${denominator} ${unit}`}</span>
      {note && <span style={{ fontSize: '12px', color: semanticColors.neutral.textMuted }}>{note}</span>}
      {onOpenSources && <span style={{ fontSize: '13px', textDecoration: 'underline' }}>Voir les sources</span>}
    </>
  );
  return <IndicatorFrame body={body} onOpenSources={onOpenSources} testId={testId} />;
}

function IndicatorFrame({ body, onOpenSources, testId }: { body: ReactNode; onOpenSources?: () => void; testId?: string }) {
  const style = {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', padding: '12px 16px', borderRadius: '6px',
    border: `1px solid ${semanticColors.neutral.border}`, background: semanticColors.neutral.surface, textAlign: 'left',
    font: 'inherit', color: 'inherit',
  } as const;
  if (onOpenSources) {
    return (
      <button type="button" className="keya-btn" data-testid={testId} onClick={onOpenSources} style={{ ...style, cursor: 'pointer' }}>
        {body}
      </button>
    );
  }
  return <div data-testid={testId} style={style}>{body}</div>;
}

/**
 * Lot 4 (PO-2026-09-28-46, -66) — variante « comptes » : pour ce qui se
 * compte sans ratio (réserves ouvertes et levées, CDC §9.3). Chaque compte
 * est un nombre entier affiché tel quel, jamais un pourcentage ; `detail`
 * précise (« La plus ancienne ouverte : 3 j »).
 */
export interface CountIndicatorProps {
  label: string;
  counts: { label: string; value: number }[];
  detail?: string;
  onOpenSources?: () => void;
  'data-testid'?: string;
}

export function CountIndicator({ label, counts, detail, onOpenSources, 'data-testid': testId }: CountIndicatorProps) {
  const body = (
    <>
      <span style={{ fontSize: '13px', fontWeight: 600, color: semanticColors.neutral.textMuted }}>{label}</span>
      <span style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {counts.map((count) => (
          <span key={count.label} data-testid={testId ? `${testId}-${count.label}` : undefined} style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ fontSize: '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: semanticColors.neutral.heading }}>
              {count.value.toLocaleString('fr-FR')}
            </span>
            <span style={{ fontSize: '13px' }}>{count.label}</span>
          </span>
        ))}
      </span>
      {detail && <span style={{ fontSize: '13px' }}>{detail}</span>}
      {onOpenSources && <span style={{ fontSize: '13px', textDecoration: 'underline' }}>Voir les sources</span>}
    </>
  );
  return <IndicatorFrame body={body} onOpenSources={onOpenSources} testId={testId} />;
}
