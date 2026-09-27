/**
 * Audit UI R1 (F06) — UN seul format de date dans toutes les apps, fuseau
 * indiqué (CDC R1 §5 : « l'interface indique son fuseau »). Scénario en Côte
 * d'Ivoire : heure d'Abidjan (GMT, sans heure d'été).
 *
 * - date et heure : `27 sept. 2026, 11:48 (GMT, Abidjan)` ;
 * - date seule (jour calendaire, ex. date de virement) : `28 sept. 2026`.
 */
export const DISPLAY_TIME_ZONE = 'Africa/Abidjan';
export const TIME_ZONE_SUFFIX = '(GMT, Abidjan)';

const DAY = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: DISPLAY_TIME_ZONE,
});
const TIME = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TIME_ZONE,
});
const CALENDAR_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Horodatage serveur (ISO 8601) → `27 sept. 2026, 11:48 (GMT, Abidjan)`. */
export function formatServerDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${DAY.format(date)}, ${TIME.format(date)} ${TIME_ZONE_SUFFIX}`;
}

/** Jour calendaire (`2026-09-28` ou ISO) → `28 sept. 2026`, sans décalage de fuseau. */
export function formatCalendarDate(value: string): string {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dayOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return dayOnly ? CALENDAR_DAY.format(date) : DAY.format(date);
}
