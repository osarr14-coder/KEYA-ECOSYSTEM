import { useEffect, useState } from 'react';

import { pathForTab, type TabRoute } from './tabRouting';

/**
 * Ticket F-031 — synchronise l'onglet actif des écrans admin (BackofficeView,
 * DevisView, PricingView, LegalPaymentTiersView) avec l'URL via l'API
 * History, sans dépendance de routeur (voir F-031-navigation-url-admin.md
 * pour la décision : 4 onglets plats derrière une seule garde admin_keyimmo
 * ne justifient pas react-router).
 *
 * `pushState`/`replaceState` UNIQUEMENT — jamais une navigation complète
 * (`location.assign`/clic sur une ancre non interceptée) : une navigation
 * complète redémarrerait `main.tsx` depuis zéro, perdant le profil `/me`
 * déjà chargé (`AuthenticatedApp`) pour un aller-retour qui n'a besoin que
 * d'un changement d'onglet.
 */
export function useUrlSyncedTab<TabId extends string>(
  routes: readonly TabRoute<TabId>[],
  fallbackId: TabId,
): [TabId, (tabId: TabId) => void] {
  const [activeTabId, setActiveTabId] = useState<TabId>(() => {
    const currentPath = window.location.pathname;
    const matched = routes.find((route) => route.path === currentPath);
    if (matched) return matched.id;

    // Chemin sans route déclarée (faute de frappe, signet périmé) : on
    // affiche le repli ET on corrige l'URL affichée — jamais laisser la
    // barre d'adresse prétendre un écran qui n'est pas réellement affiché.
    window.history.replaceState(null, '', pathForTab(routes, fallbackId));
    return fallbackId;
  });

  useEffect(() => {
    function handlePopState() {
      const matched = routes.find((route) => route.path === window.location.pathname);
      setActiveTabId(matched ? matched.id : fallbackId);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // routes/fallbackId sont des constantes de module côté appelant
    // (`App.tsx::TAB_ROUTES`) — jamais recréées entre rendus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function navigate(tabId: TabId) {
    const path = pathForTab(routes, tabId);
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setActiveTabId(tabId);
  }

  return [activeTabId, navigate];
}
