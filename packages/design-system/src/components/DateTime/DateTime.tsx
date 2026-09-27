import { formatCalendarDate, formatServerDateTime } from '../../format/dates';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §9) : date affichée par le formateur
 * unique — `27 sept. 2026, 14:05 (GMT, Abidjan)` pour un horodatage serveur,
 * `28 sept. 2026` pour un jour calendaire. `<time dateTime>` garde la valeur
 * machine.
 */
export interface DateTimeProps {
  value: string | null | undefined;
  mode?: 'datetime' | 'date';
  'data-testid'?: string;
}

export function DateTime({ value, mode = 'datetime', 'data-testid': testId }: DateTimeProps) {
  if (!value) return <span data-testid={testId}>—</span>;
  return (
    <time dateTime={value} data-testid={testId} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {mode === 'date' ? formatCalendarDate(value) : formatServerDateTime(value)}
    </time>
  );
}
