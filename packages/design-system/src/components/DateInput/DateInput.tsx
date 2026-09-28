import { Select } from '../Select/Select';

/**
 * PO-2026-09-28-11 (F06) — saisie d'un jour calendaire au format unique de
 * l'interface (« 28 sept. 2026 ») : jour · mois abrégé · année. Le champ
 * natif `type="date"` affiche le format du navigateur (« 09/28/2026 »)
 * quelle que soit la langue de la page ; il n'est donc plus utilisé.
 *
 * `value` et `onChange` restent au format ISO `AAAA-MM-JJ`. Chaque liste a
 * son libellé (« <label> — jour », « — mois », « — année ») ; le groupe
 * porte `label`.
 */
export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export interface DateInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Années proposées autour de l'année courante (défaut : 2 avant, 2 après). */
  yearsBefore?: number;
  yearsAfter?: number;
  'data-testid'?: string;
}

function daysIn(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function DateInput({
  label, value, onChange, yearsBefore = 2, yearsAfter = 2, 'data-testid': testId,
}: DateInputProps) {
  const today = new Date();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = match ? Number(match[1]) : today.getFullYear();
  const month = match ? Number(match[2]) : today.getMonth() + 1;
  const day = match ? Number(match[3]) : today.getDate();
  const currentYear = today.getFullYear();
  const years = Array.from({ length: yearsBefore + yearsAfter + 1 }, (_, index) => currentYear - yearsBefore + index);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => a - b);

  function emit(nextYear: number, nextMonth: number, nextDay: number) {
    const safeDay = Math.min(nextDay, daysIn(nextYear, nextMonth));
    onChange(`${nextYear}-${pad(nextMonth)}-${pad(safeDay)}`);
  }

  return (
    <div role="group" aria-label={label} data-testid={testId} style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap' }}>
      <Select
        aria-label={`${label} — jour`}
        value={day}
        onChange={(event) => emit(year, month, Number(event.target.value))}
        style={{ width: '72px', padding: '0 8px' }}
      >
        {Array.from({ length: daysIn(year, month) }, (_, index) => index + 1).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </Select>
      <Select
        aria-label={`${label} — mois`}
        value={month}
        onChange={(event) => emit(year, Number(event.target.value), day)}
        style={{ width: '92px', padding: '0 8px' }}
      >
        {MONTHS_SHORT.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
      </Select>
      <Select
        aria-label={`${label} — année`}
        value={year}
        onChange={(event) => emit(Number(event.target.value), month, day)}
        style={{ width: '92px', padding: '0 8px' }}
      >
        {years.map((option) => <option key={option} value={option}>{option}</option>)}
      </Select>
    </div>
  );
}
