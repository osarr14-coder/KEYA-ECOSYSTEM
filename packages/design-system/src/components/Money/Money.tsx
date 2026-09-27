import { formatMoney } from '../../format/numbers';
import { semanticColors } from '../../tokens/colors';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §9) : montant normalisé — entiers XOF,
 * espace fine insécable, devise visible, chiffres tabulaires. Six notions
 * jamais confondues ; le NON AFFECTÉ n'est jamais masqué et passe en gras
 * dès qu'il est non nul.
 */
export type MoneyKind = 'expected' | 'received' | 'allocated' | 'unallocated' | 'reserved' | 'available';

export const MONEY_KIND_LABELS: Record<MoneyKind, string> = {
  expected: 'Attendu',
  received: 'Encaissé',
  allocated: 'Affecté',
  unallocated: 'Non affecté',
  reserved: 'Réservé',
  available: 'Disponible',
};

export interface MoneyProps {
  value: string | number | null | undefined;
  currency?: string;
  kind?: MoneyKind;
  'data-testid'?: string;
}

export function Money({ value, currency = 'XOF', kind, 'data-testid': testId }: MoneyProps) {
  const emphasize = kind === 'unallocated' && Number(value ?? 0) !== 0;
  return (
    <span
      data-testid={testId}
      data-kind={kind}
      style={{
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        fontWeight: emphasize ? 700 : undefined,
        color: emphasize ? semanticColors.alert.text : undefined,
      }}
    >
      {formatMoney(value, currency)}
    </span>
  );
}
