import { useEffect, useRef, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, AppShell, Select, buildCrossAppUrl, resolveAppOrigins, useOnlineStatus,
  type AppModule, type IconName, logoutToLoginScreen,
} from '@keya/design-system';

import { useApiClient } from './api/ApiClientContext';
import { useApiResource } from './api/useApiResource';
import { EvidenceFeedView } from './views/EvidenceFeedView';
import { MyActionsView } from './views/MyActionsView';
import { OverviewView } from './views/OverviewView';
import { ClientSalesView } from './views/ClientSalesView';
import { ProgramRequestView } from './views/ProgramRequestView';

// Réutilise AppShell tel quel (ticket 007) — aucune redéfinition. Le module
// professionnel FINANCE reste masqué tant que `userRoles` (dérivé de `/me`,
// ticket 019) ne contient pas 'sponsor' — comportement générique d'AppShell,
// pas recodé ici. Aucune app FINANCE dédiée n'existe encore (limitation MVP
// assumée, voir `redirectTarget.ts` côté apps/web) : volontairement pas
// touché par le ticket F-040 ci-dessous.
//
// Ticket F-040 — deux bugs réels constatés en navigateur : (1) un seul
// module "BUILD" (`href: '/build'`) était requis à la fois pour
// 'constructeur' ET 'inspecteur', alors qu'un inspecteur doit atterrir sur
// CONTROL (mapping `resolveRedirectApp`, tickets 020/021) — un inspecteur
// cliquant "BUILD" depuis HOME se serait retrouvé sur la MAUVAISE app ; (2)
// même en ignorant ce mauvais mapping, `href: '/build'` restait un chemin
// relatif SUR L'ORIGINE DE HOME (aucun routeur ici) — un lien mort. Scindé
// en deux modules distincts, chacun avec une vraie URL cross-origine (même
// mécanisme de transfert de session qu'à la connexion), recalculée à CHAQUE
// rendu (jamais mémoïsée) pour ne jamais embarquer un jeton périmé.
const APP_ORIGINS = resolveAppOrigins();

function crossAppModules(): AppModule[] {
  const accessToken = localStorage.getItem('keya_access_token');
  const refreshToken = localStorage.getItem('keya_refresh_token');
  const crossAppHref = (origin: string) => (
    accessToken && refreshToken ? buildCrossAppUrl(origin, accessToken, refreshToken) : origin
  );

  return [
    {
      id: 'build', label: 'BUILD', href: crossAppHref(APP_ORIGINS.build), requiredRoles: ['constructeur'], icon: 'building', group: 'Autres espaces',
    },
    {
      id: 'control', label: 'CONTROL', href: crossAppHref(APP_ORIGINS.control), requiredRoles: ['inspecteur'], icon: 'clipboard-check', group: 'Autres espaces',
    },
    {
      id: 'finance', label: 'FINANCE', href: '/finance', requiredRoles: ['sponsor'], icon: 'wallet', group: 'Autres espaces',
    },
    {
      id: 'notary', label: 'NOTARY', href: '/notary', requiredRoles: ['notaire'], icon: 'shield-check', group: 'Autres espaces',
    },
  ];
}

type ViewId = 'acquisition' | 'overview' | 'evidence' | 'actions' | 'program-request';

/**
 * Ticket F-074 (direction « Confiance premium ») — navigation UNIQUE : les
 * anciens onglets (`TabBar`) deviennent les entrées de la barre latérale
 * (`AppShell.onModuleSelect`), sans rechargement. « Mes actions » est
 * désormais toujours visible (un client sans bien reçoit aussi des
 * notifications : appel de fonds, confirmation de virement…).
 */
const VIEW_MODULES: Record<ViewId, { label: string; icon: IconName }> = {
  // Ticket F-066 — parcours d'achat du client (ex-onglet « Acheter un bien »).
  acquisition: { label: 'Mon acquisition', icon: 'wallet' },
  overview: { label: "Vue d'ensemble", icon: 'home' },
  evidence: { label: 'Avancement & preuves', icon: 'file-text' },
  actions: { label: 'Mes actions', icon: 'clipboard-check' },
  // Ticket F-057 — réservé au rôle `sponsor` (jamais `client`, qui achète
  // un lot existant plutôt que de faire construire sur mesure).
  'program-request': { label: 'Programme sur mesure', icon: 'building' },
};

const ACTIVE_ORGANIZATION_STORAGE_KEY = 'keya_active_organization_id';

export function App() {
  const api = useApiClient();
  const meState = useApiResource(() => api.getMe(), []);
  // Ticket F-033 (vague 2) — implémentation UNIQUE promue au design system
  // (`useOnlineStatus`, extraite de CONTROL PWA, ticket 010 passe 2) : une
  // coupure réseau ne doit plus ressembler à une erreur serveur générique.
  const isOnline = useOnlineStatus();

  // Ticket 019 — App Switcher multi-rôle. `userRoles` (codé en dur avant ce
  // ticket, jamais utilisé en production puisque `main.tsx` rend `<App />`
  // sans prop) est désormais dérivé de la membership ACTIVE, jamais d'une
  // valeur par défaut.
  //
  // `activeOrganizationId` est dérivé PENDANT LE RENDU, jamais recalculé
  // dans un `useEffect` séparé : un choix explicite (switcher) prend le
  // dessus ; sinon, tant que `/me` n'a pas encore répondu, la valeur
  // persistée sert de valeur OPTIMISTE (évite un premier fetch inutile avec
  // `null` pour l'utilisateur courant, le cas le plus fréquent) ; une fois
  // `/me` répondu, elle n'est retenue que si elle correspond à une
  // membership RÉELLE (jamais une valeur périmée d'une session précédente
  // sur le même navigateur), sinon la première membership connue prend le
  // relais — dans TOUS les cas calculé en une seule passe de rendu, pas une
  // cascade d'effets qui retarderait la stabilisation de plusieurs cycles.
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

  // Persistance en effet de bord SEUL (n'influence jamais `activeOrganizationId`
  // lui-même, qui reste dérivé pendant le rendu ci-dessus) — dès que la
  // résolution change, qu'il s'agisse d'un choix explicite ou de la
  // correction du fallback initial.
  useEffect(() => {
    if (activeOrganizationId) localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, activeOrganizationId);
  }, [activeOrganizationId]);

  function handleOrganizationChange(organizationId: string) {
    setManualOrganizationId(organizationId);
  }

  const activeMembership = memberships.find((membership) => membership.organization_id === activeOrganizationId);
  const userRoles = activeMembership ? [activeMembership.role_code] : [];
  // AppShell n'affiche son sélecteur que si `organizationOptions` est
  // renseigné (`organizationOptions.length > 0`) — ne le peupler que s'il y
  // a RÉELLEMENT plusieurs organisations, jamais pour une seule.
  const organizationOptions = memberships.length > 1
    ? memberships.map((membership) => ({ id: membership.organization_id, label: membership.organization_name }))
    : [];

  // Ne fetch RÉELLEMENT qu'une fois `/me` résolu (`activeOrganizationId`
  // alors déjà correctement dérivé, ci-dessus, dans la MÊME passe de rendu)
  // — jamais un premier appel réseau gaspillé avec une organisation encore
  // inconnue (`null`), pur artefact du chargement initial de `/me`.
  const lotsState = useApiResource(
    () => (meState.status === 'success' ? api.getMyLots() : Promise.resolve([])),
    [meState.status, activeOrganizationId],
  );
  // Ticket F-060 — câble le compteur de la cloche AppShell
  // (`taskInboxCount`, jamais renseigné jusqu'ici, toujours 0 par défaut) :
  // même garde de fetch et mêmes deps que `lotsState` ci-dessus
  // (`activeOrganizationId` déclenche un refetch réel, pas seulement un
  // rafraîchissement de confort — `tasks_task` a une policy RLS mono-
  // organisation, la visibilité d'une Task change RÉELLEMENT en changeant
  // d'organisation active).
  const taskInboxState = useApiResource(
    () => (meState.status === 'success' ? api.getMyTasks({ status: 'pending' }) : Promise.resolve([])),
    [meState.status, activeOrganizationId],
  );
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<ViewId | null>(null);

  // Un lot sélectionné manuellement dans une organisation devient invalide
  // après un changement d'organisation — jamais le laisser survivre au
  // switch, sous peine de tenter de charger un lot qui n'appartient plus à
  // l'organisation active.
  useEffect(() => {
    setSelectedLotId(null);
  }, [activeOrganizationId]);

  const lots = lotsState.status === 'success' ? lotsState.data : [];
  const currentLotId = selectedLotId ?? lots[0]?.id ?? null;
  const isSponsor = userRoles.includes('sponsor');
  const isClient = userRoles.includes('client');
  const lotsReady = meState.status === 'success' && lotsState.status === 'success';

  const availableViews: ViewId[] = [
    ...(isClient ? ['acquisition' as const] : []),
    ...(currentLotId ? ['overview' as const, 'evidence' as const] : []),
    'actions',
    ...(isSponsor ? ['program-request' as const] : []),
  ];
  // Vue par défaut : le bien s'il existe, sinon le parcours d'achat (client)
  // ou la demande sur mesure (sponsor) — jamais un écran vide.
  const defaultView: ViewId = currentLotId
    ? 'overview'
    : isClient ? 'acquisition' : isSponsor ? 'program-request' : 'overview';
  const activeView: ViewId = selectedView && availableViews.includes(selectedView) ? selectedView : defaultView;
  const pendingTaskCount = taskInboxState.status === 'success' ? taskInboxState.data.length : 0;

  const modules: AppModule[] = [
    ...availableViews.map((view) => ({
      id: view,
      label: VIEW_MODULES[view].label,
      icon: VIEW_MODULES[view].icon,
      href: `#${view}`,
      badge: view === 'actions' ? pendingTaskCount : undefined,
    })),
    ...crossAppModules(),
  ];

  return (
    <AppShell
      // Ticket F-070 — déconnexion volontaire, vers l'écran de connexion.
      onLogout={() => logoutToLoginScreen()}
      density="confortable"
      // Ticket F-039/F-073 — filet or sous la barre du haut (espace client).
      brand
      appLabel="Espace client"
      modules={modules}
      userRoles={userRoles}
      activeModuleId={lotsReady ? activeView : undefined}
      onModuleSelect={(id) => setSelectedView(id as ViewId)}
      taskInboxCount={pendingTaskCount}
      // Ticket F-061 — la cloche ouvre « Mes actions » (`MyActionsView`),
      // jamais un second écran de tâches recodé.
      onTaskInboxClick={() => setSelectedView('actions')}
      organizationOptions={organizationOptions}
      activeOrganizationId={activeOrganizationId ?? undefined}
      onOrganizationChange={handleOrganizationChange}
    >
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
        // `AlertBanner` (incohérence déjà notée à l'audit) au passage,
        // exactement le même défaut (erreur de chargement générique) que
        // les autres cibles de cette vague. Ticket F-033 (vague 4) :
        // `ApiErrorBanner` distingue désormais un 403 (accès refusé, jamais
        // retentable) du reste — un 401 est traité séparément et
        // automatiquement (déconnexion, voir `main.tsx::onUnauthorized`).
        <ApiErrorBanner error={meState.error} title="Impossible de charger votre profil." onRetry={meState.refetch} />
      )}
      {meState.status === 'success' && lotsState.status === 'loading' && <p>Chargement…</p>}
      {meState.status === 'success' && lotsState.status === 'error' && (
        <ApiErrorBanner error={lotsState.error} title="Impossible de charger vos biens." onRetry={lotsState.refetch} />
      )}
      {lotsReady && activeView === 'acquisition' && <ClientSalesView />}
      {lotsReady && activeView === 'program-request' && <ProgramRequestView />}
      {lotsReady && activeView === 'actions' && <MyActionsView activeOrganizationId={activeOrganizationId} />}
      {lotsReady && activeView === 'overview' && !currentLotId && (
        <p>Aucun bien ne vous est encore associé.</p>
      )}

      {lotsReady && currentLotId && (activeView === 'overview' || activeView === 'evidence') && (
        <>
          {lots.length > 1 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', fontWeight: 600 }}>
              Bien
              <Select
                aria-label="Sélection du bien"
                value={currentLotId}
                onChange={(event) => setSelectedLotId(event.target.value)}
                style={{ width: 'auto' }}
              >
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.asset_name} — {lot.name}
                  </option>
                ))}
              </Select>
            </label>
          )}

          {activeView === 'overview' && (
            <OverviewView
              lotId={currentLotId}
              onSeeAllActions={() => setSelectedView('actions')}
              activeOrganizationId={activeOrganizationId}
            />
          )}
          {activeView === 'evidence' && <EvidenceFeedView lotId={currentLotId} />}
        </>
      )}
    </AppShell>
  );
}
