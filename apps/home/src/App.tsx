import { useEffect, useRef, useState } from 'react';

import {
  AlertBanner, AppShell, TabBar, useOnlineStatus, type AppModule,
} from '@keya/design-system';

import { useApiClient } from './api/ApiClientContext';
import { useApiResource } from './api/useApiResource';
import { EvidenceFeedView } from './views/EvidenceFeedView';
import { MyActionsView } from './views/MyActionsView';
import { OverviewView } from './views/OverviewView';

// Réutilise AppShell tel quel (ticket 007) — aucune redéfinition. Les
// modules professionnels (BUILD/FINANCE/NOTARY) restent masqués tant que
// `userRoles` (dérivé de `/me`, ticket 019) ne contient pas le rôle
// correspondant — comportement générique d'AppShell, pas recodé ici.
const MODULES: AppModule[] = [
  { id: 'home', label: 'Accueil', href: '/' },
  { id: 'build', label: 'BUILD', href: '/build', requiredRoles: ['constructeur', 'inspecteur'] },
  { id: 'finance', label: 'FINANCE', href: '/finance', requiredRoles: ['sponsor'] },
  { id: 'notary', label: 'NOTARY', href: '/notary', requiredRoles: ['notaire'] },
];

type ViewId = 'overview' | 'evidence' | 'actions';

const TABS: { id: ViewId; label: string }[] = [
  { id: 'overview', label: "Vue d'ensemble" },
  { id: 'evidence', label: 'Avancement & preuves' },
  { id: 'actions', label: 'Mes actions' },
];

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
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewId>('overview');

  // Un lot sélectionné manuellement dans une organisation devient invalide
  // après un changement d'organisation — jamais le laisser survivre au
  // switch, sous peine de tenter de charger un lot qui n'appartient plus à
  // l'organisation active.
  useEffect(() => {
    setSelectedLotId(null);
  }, [activeOrganizationId]);

  const lots = lotsState.status === 'success' ? lotsState.data : [];
  const currentLotId = selectedLotId ?? lots[0]?.id ?? null;

  return (
    <AppShell
      density="confortable"
      modules={MODULES}
      userRoles={userRoles}
      activeModuleId="home"
      breadcrumbs={[{ label: 'Accueil' }]}
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
        // les autres cibles de cette vague.
        <AlertBanner title="Impossible de charger votre profil." onRetry={meState.refetch} />
      )}
      {meState.status === 'success' && lotsState.status === 'loading' && <p>Chargement…</p>}
      {meState.status === 'success' && lotsState.status === 'error' && (
        <AlertBanner title="Impossible de charger vos biens." onRetry={lotsState.refetch} />
      )}
      {meState.status === 'success' && lotsState.status === 'success' && lots.length === 0 && (
        <p>Aucun bien ne vous est encore associé.</p>
      )}

      {meState.status === 'success' && currentLotId && (
        <>
          {lots.length > 1 && (
            <label>
              Bien
              <select
                aria-label="Sélection du bien"
                value={currentLotId}
                onChange={(event) => setSelectedLotId(event.target.value)}
              >
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.asset_name} — {lot.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <TabBar tabs={TABS} activeTabId={activeTab} onChange={(id) => setActiveTab(id as ViewId)} aria-label="Sections HOME" />

          {activeTab === 'overview' && (
            <OverviewView
              lotId={currentLotId}
              onSeeAllActions={() => setActiveTab('actions')}
              activeOrganizationId={activeOrganizationId}
            />
          )}
          {activeTab === 'evidence' && <EvidenceFeedView lotId={currentLotId} />}
          {activeTab === 'actions' && <MyActionsView activeOrganizationId={activeOrganizationId} />}
        </>
      )}
    </AppShell>
  );
}
