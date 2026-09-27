/**
 * Formats d'affichage partagés par le parcours client (F-066, F-074).
 * CDC V3 §5 : « l'interface indique son fuseau ». Scénario en Côte
 * d'Ivoire : heure d'Abidjan (GMT, sans heure d'été).
 */
export const DISPLAY_TIME_ZONE = 'Africa/Abidjan';

export function formatAmount(value: string, currency: string) {
  const amount = Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  return `${amount} ${currency}`;
}

export function formatDateTime(iso: string) {
  const formatted = new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: DISPLAY_TIME_ZONE,
  });
  return `${formatted} (heure d'Abidjan, GMT)`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: DISPLAY_TIME_ZONE });
}
