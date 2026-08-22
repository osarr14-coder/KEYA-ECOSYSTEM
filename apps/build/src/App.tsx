import { useEffect, useRef, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, AppShell, TabBar, buildCrossAppUrl, resolveAppOrigins, useOnlineStatus,
  type AppModule, type IconName,
} from '@keya/design-system';

import { useApiClient } from './api/ApiClientContext';
import { useApiResource } from './api/useApiResource';
import { AllLotsView } from './views/AllLotsView';
import { ExceptionsView } from './views/ExceptionsView';

// Réutilise AppShell tel quel (ticket 007), variante dense (ticket 009,
// écran professionnel à fort volume) — aucune redéfinition. Les modules
// professionnels (FINANCE/NOTARY) restent masqués tant que `userRoles`
// (dérivé de `/me`, ticket 019) ne contient pas le rôle correspondant —
// aucune app dédiée ne les sert encore (limitation MVP assumée, voir
// `redirectTarget.ts` côté apps/web), volontairement pas touché ici.
//
// Ticket F-040 — `home.href` NE PEUT PLUS être un chemin relatif (`/`) :
// vérifié en navigateur réel, apps/build n'a aucun routeur, donc `/` y
// rendait la MÊME vue Control Tower que `/build` (lien mort, pas de bug
// visible dans la barre d'URL mais un contenu strictement identique).
// `buildModules` construit maintenant une vraie URL cross-origine vers HOME
// avec transfert de session (même mécanisme que la connexion, tickets
// 020/021), recalculée à CHAQUE rendu (jamais mémoïsée) pour ne jamais
// embarquer un jeton périmé si l'utilisateur clique longtemps après le
// montage.
const APP_ORIGINS = resolveAppOrigins();

function buildModules(): AppModule[] {
  const accessToken = localStorage.getItem('keya_access_token');
  const refreshToken = localStorage.getItem('keya_refresh_token');
  const homeHref = accessToken && refreshToken
    ? buildCrossAppUrl(APP_ORIGINS.home, accessToken, refreshToken)
    : APP_ORIGINS.home;

  return [
    { id: 'home', label: 'Accueil', href: homeHref, icon: 'home' },
    {
      id: 'build', label: 'BUILD', href: '/build', requiredRoles: ['constructeur', 'inspecteur'], icon: 'building',
    },
    {
      id: 'finance', label: 'FINANCE', href: '/finance', requiredRoles: ['sponsor'], icon: 'wallet',
    },
    {
      id: 'notary', label: 'NOTARY', href: '/notary', requiredRoles: ['notaire'], icon: 'shield-check',
    },
  ];
}

type ViewId = 'exceptions' | 'all_lots';

const TABS: { id: ViewId; label: string; icon: IconName }[] = [
  { id: 'exceptions', label: 'Exceptions', icon: 'alert-triangle' },
  { id: 'all_lots', label: 'Tous les lots', icon: 'building' },
];

const ACTIVE_ORGANIZATION_STORAGE_KEY = 'keya_active_organization_id';

export function App() {
  const api = useApiClient();
  const meState = useApiResource(() => api.getMe(), []);
  // Ticket F-033 (vague 2) — implémentation UNIQUE promue au design system
  // (`useOnlineStatus`, extraite de CONTROL PWA, ticket 010 passe 2) : une
  // coupure réseau ne doit plus ressembler à une erreur serveur générique.
  const isOnline = useOnlineStatus();

  // Ticket 019 — App Switcher multi-rôle : voir apps/home/src/App.tsx pour
  // le détail de cette dérivation (même schéma exact). `activeOrganizationId`
  // est calculé PENDANT LE RENDU, jamais via un `useEffect` séparé qui
  // retarderait sa stabilisation de plusieurs cycles.
  const [manualOrganizationId, setManualOrganizationId] = useState<string | null>(null);
  const persistedOrganizationIdRef = useRef<string | null>(
    localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY),
  );

  const memberships = meState.status === 'success' ? meState.data.memberships : [];
  const persistedIsValidMembership = memberships.some(
    (membership) => membership.organization_id === persistedOrganizationIdRef.current,
  );
  const resolvedOrganizationId = meState.status === 'success'
    ? (persistedIsValidMembership ? persistedOrganizationIdRef.current : memberships[0]?.organization_id ?? null)
    : persistedOrganizationIdRef.current;
  const activeOrganizationId = manualOrganizationId ?? resolvedOrganizationId;

  useEffect(() => {
    if (activeOrganizationId) localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, activeOrganizationId);
  }, [activeOrganizationId]);

  function handleOrganizationChange(organizationId: string) {
    setManualOrganizationId(organizationId);
  }

  const activeMembership = memberships.find((membership) => membership.organization_id === activeOrganizationId);
  const userRoles = activeMembership ? [activeMembership.role_code] : [];
  const organizationOptions = memberships.length > 1
    ? memberships.map((membership) => ({ id: membership.organization_id, label: membership.organization_name }))
    : [];

  // "Exceptions" est la vue PAR DÉFAUT — critère d'acceptation central du
  // ticket 009 : jamais un tableau de bord KPI au premier rendu.
  const [activeTab, setActiveTab] = useState<ViewId>('exceptions');
  const [lotSearchFilter, setLotSearchFilter] = useState('');

  function handleViewLotInTable(lotName: string) {
    setLotSearchFilter(lotName);
    setActiveTab('all_lots');
  }

  return (
    <AppShell
      density="dense"
      // Ticket F-048 — révision LIMITÉE de la doctrine 17.3 : le bloc navy
      // de sidebar (AppShell, toujours rendu) est universel sur les 4
      // apps ; `brand` (bandeau <header>) reste HOME-only, non activé ici.
      appLabel="BUILD"
      modules={buildModules()}
      userRoles={userRoles}
      activeModuleId="build"
      breadcrumbs={[{ label: 'BUILD' }]}
      organizationOptions={organizationOptions}
      activeOrganizationId={activeOrganizationId ?? undefined}
      onOrganizationChange={handleOrganizationChange}
    >
      <TabBar tabs={TABS} activeTabId={activeTab} onChange={(id) => setActiveTab(id as ViewId)} aria-label="Sections BUILD" />

      {!isOnline && (
        <div style={{ marginBottom: '12px' }}>
          <AlertBanner title="Hors ligne">
            Les actions nécessitant le réseau échoueront tant que la connexion n&apos;est pas rétablie.
          </AlertBanner>
        </div>
      )}

      {meState.status === 'loading' && <p>Chargement…</p>}
      {meState.status === 'error' && (
        // Ticket F-033 (vague 3) — remplace un `<p role="alert">` par
        // `AlertBanner` (incohérence déjà notée à l'audit) au passage, même
        // défaut (erreur de chargement générique) que les autres cibles.
        // Ticket F-033 (vague 4) : `ApiErrorBanner` distingue un 403.
        <ApiErrorBanner error={meState.error} title="Impossible de charger votre profil." onRetry={meState.refetch} />
      )}
      {meState.status === 'success' && (
        <>
          {/* Ticket 019 : les vues ne montent (et ne fetchent) qu'une fois
              `activeOrganizationId` RÉSOLU — jamais un premier appel réseau
              gaspillé avec une organisation encore inconnue (`null`), pur
              artefact du chargement initial de `/me`. */}
          {activeTab === 'exceptions' && (
            <ExceptionsView onViewLotInTable={handleViewLotInTable} activeOrganizationId={activeOrganizationId} />
          )}
          {activeTab === 'all_lots' && (
            <AllLotsView initialSearch={lotSearchFilter} activeOrganizationId={activeOrganizationId} />
          )}
        </>
      )}
    </AppShell>
  );
}
