/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §9) : formateurs partagés des montants et
 * des surfaces. Montants en entiers, séparateur de milliers = espace fine
 * insécable (U+202F), code devise toujours visible : `30 000 000 XOF`.
 * Surfaces sans décimales inutiles : `75 m²`, `82,5 m²` (X01).
 */

const NARROW_NBSP = ' ';

export function formatMoney(value: string | number | null | undefined, currency = 'XOF'): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  const rounded = Math.round(amount);
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  return `${rounded < 0 ? '−' : ''}${digits} ${currency}`;
}

export function formatSurface(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const surface = Number(value);
  if (!Number.isFinite(surface)) return null;
  return `${surface.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} m²`;
}

/** Accord réel en nombre : `pluralize(2, 'lot')` → `2 lots` (X02, jamais « lot(s) »). */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count > 1 ? plural : singular}`;
}
