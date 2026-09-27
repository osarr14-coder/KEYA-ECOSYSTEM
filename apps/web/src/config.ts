/**
 * Audit UI R1 (R04, PO-2026-09-27-03) — Devis / Appels d'offres, Demandes
 * de programme et Tarifs (CDC §3, différé) : masqués du MVP, code conservé.
 * Même réglage que `KEYA_DEFERRED_MODULES_ENABLED` côté serveur, qui répond
 * 404 sur leurs routes : ce drapeau n'évite que des écrans vides.
 */
export function deferredModulesEnabled(): boolean {
  return import.meta.env.VITE_DEFERRED_MODULES_ENABLED === 'true';
}
