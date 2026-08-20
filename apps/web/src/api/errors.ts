import { ApiError } from './client';

/**
 * Erreurs au format de validation DRF standard (`{champ: ["message"]}`) —
 * PAS `{detail: "..."}` (voir `ApiError.detail`, géré partout ailleurs dans
 * ce projet). Les messages sont affichés EXACTEMENT tels que renvoyés par
 * le backend, jamais reformulés côté frontend.
 *
 * Extrait de `PricingView.tsx` (ticket F-028, `formatPricingApiError`) au
 * ticket F-030, une fois `LegalPaymentTiersView.tsx` devenu un second
 * consommateur du même format d'erreur — même discipline anti-duplication
 * déjà appliquée ailleurs dans ce projet (ex. `LEVEL_PROGRESS_FRACTION`,
 * migré vers `apps/trust/services.py` au ticket 009 backend quand BUILD en
 * est devenu le second consommateur).
 */
export function formatDrfFieldErrors(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiError)) return fallback;
  if (caught.detail) return caught.detail;
  if (caught.body && typeof caught.body === 'object') {
    const messages = Object.values(caught.body as Record<string, unknown>)
      .flat()
      .filter((value): value is string => typeof value === 'string');
    if (messages.length > 0) return messages.join(' ');
  }
  return fallback;
}
