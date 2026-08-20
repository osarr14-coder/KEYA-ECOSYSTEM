/**
 * Ticket F-031 — table id ↔ chemin unique pour les onglets admin d'apps/web.
 * Fonctions pures, testables sans DOM : la lecture/écriture réelle de
 * `window.location`/`history` vit uniquement dans `useUrlSyncedTab.ts`.
 */
export interface TabRoute<TabId extends string> {
  id: TabId;
  path: string;
}

/**
 * Résout l'onglet actif à partir d'un `pathname`. Un chemin qui ne
 * correspond à AUCUNE route déclarée (faute de frappe, lien périmé, ancien
 * signet) retombe sur `fallbackId` — jamais une page blanche ni une
 * exception : cohérent avec le comportement par défaut déjà en place avant
 * ce ticket (`activeTab` démarrait toujours à `'backoffice'`).
 */
export function resolveTabFromPath<TabId extends string>(
  routes: readonly TabRoute<TabId>[],
  pathname: string,
  fallbackId: TabId,
): TabId {
  return routes.find((route) => route.path === pathname)?.id ?? fallbackId;
}

/**
 * Chemin déclaré pour un onglet. `tabId` provient toujours d'une valeur déjà
 * validée (`TAB_DEFINITIONS` dans `App.tsx`) — une route manquante est une
 * erreur de configuration, jamais un cas d'exécution normal à absorber
 * silencieusement.
 */
export function pathForTab<TabId extends string>(
  routes: readonly TabRoute<TabId>[],
  tabId: TabId,
): string {
  const route = routes.find((candidate) => candidate.id === tabId);
  if (!route) {
    throw new Error(`Aucun chemin déclaré pour l'onglet "${tabId}".`);
  }
  return route.path;
}
