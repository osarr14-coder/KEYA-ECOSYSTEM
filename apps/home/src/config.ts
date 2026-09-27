/**
 * Audit UI R1 (R04, PO-2026-09-27-03 et PO-2026-09-27-13) — « Programme sur
 * mesure » (demandes de programme, rôle `sponsor`) : module différé, masqué
 * du MVP, code conservé. KEYIMMO AFRIC lance lui-même les programmes ; un
 * promoteur qui le consulte n'est pas un rôle de la plateforme. Même réglage
 * que `KEYA_DEFERRED_MODULES_ENABLED` côté serveur (routes en 404).
 */
export function deferredModulesEnabled(): boolean {
  return import.meta.env.VITE_DEFERRED_MODULES_ENABLED === 'true';
}
