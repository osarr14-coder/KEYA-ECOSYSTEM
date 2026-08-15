import { useState } from 'react';

import { AppShell, type AppModule } from '@keya/design-system';

import { useApiClient } from './api/ApiClientContext';
import { useApiResource } from './api/useApiResource';
import { EvidenceFeedView } from './views/EvidenceFeedView';
import { MyActionsView } from './views/MyActionsView';
import { OverviewView } from './views/OverviewView';

// Réutilise AppShell tel quel (ticket 007) — aucune redéfinition. Les
// modules professionnels (BUILD/FINANCE/NOTARY) restent masqués tant que
// `userRoles` (typiquement `['client']` pour cette app) ne contient pas le
// rôle correspondant — comportement générique d'AppShell, pas recodé ici.
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

export interface AppProps {
  userRoles?: string[];
}

export function App({ userRoles = ['client'] }: AppProps) {
  const api = useApiClient();
  const lotsState = useApiResource(() => api.getMyLots(), []);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewId>('overview');

  const lots = lotsState.status === 'success' ? lotsState.data : [];
  const currentLotId = selectedLotId ?? lots[0]?.id ?? null;

  return (
    <AppShell
      density="confortable"
      modules={MODULES}
      userRoles={userRoles}
      activeModuleId="home"
      breadcrumbs={[{ label: 'Accueil' }]}
    >
      {lotsState.status === 'loading' && <p>Chargement…</p>}
      {lotsState.status === 'error' && <p role="alert">Impossible de charger vos biens.</p>}
      {lotsState.status === 'success' && lots.length === 0 && (
        <p>Aucun bien ne vous est encore associé.</p>
      )}

      {currentLotId && (
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

          <nav aria-label="Sections HOME">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab === 'overview' && (
            <OverviewView lotId={currentLotId} onSeeAllActions={() => setActiveTab('actions')} />
          )}
          {activeTab === 'evidence' && <EvidenceFeedView lotId={currentLotId} />}
          {activeTab === 'actions' && <MyActionsView />}
        </>
      )}
    </AppShell>
  );
}
