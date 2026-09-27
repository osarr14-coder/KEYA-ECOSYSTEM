/**
 * Formats d'affichage partagés par le parcours client (F-066, F-074).
 * Audit UI R1 (F06) : un seul format de date pour toutes les apps, fuseau
 * indiqué — délégué au design system.
 */
import { DISPLAY_TIME_ZONE, formatCalendarDate, formatServerDateTime } from '@keya/design-system';

export { DISPLAY_TIME_ZONE };

export function formatAmount(value: string, currency: string) {
  const amount = Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  return `${amount} ${currency}`;
}

export function formatDateTime(iso: string) {
  return formatServerDateTime(iso);
}

export function formatDate(iso: string) {
  return formatCalendarDate(iso);
}
