const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

/**
 * Backoff exponentiel partagé par la file de données ET la file média
 * (chacune avec son propre compteur — voir `InspectionDraft.retryCount` et
 * `LocalPhoto.retryCount`) : 2s, 4s, 8s, 16s, 32s, plafonné à 60s. Jamais
 * d'abandon — juste un délai croissant avant la prochaine tentative
 * (ticket 010, passe 2 : "jamais un abandon silencieux").
 */
export function computeBackoffDelayMs(retryCount: number): number {
  if (retryCount <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (retryCount - 1), MAX_DELAY_MS);
}

export function computeNextRetryAt(retryCount: number, now: Date = new Date()): string {
  return new Date(now.getTime() + computeBackoffDelayMs(retryCount)).toISOString();
}
