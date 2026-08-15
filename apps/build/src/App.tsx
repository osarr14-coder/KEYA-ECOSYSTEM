import { useState } from 'react';

import { AppShell, type AppModule } from '@keya/design-system';

import { AllLotsView } from './views/AllLotsView';
import { ExceptionsView } from './views/ExceptionsView';

// Réutilise AppShell tel quel (ticket 007), variante dense (ticket 009,
// écran professionnel à fort volume) — aucune redéfinition.
const MODULES: AppModule[] = [
  { id: 'home', label: 'Accueil', href: '/' },
  { id: 'build', label: 'BUILD', href: '/build', requiredRoles: ['constructeur', 'inspecteur'] },
  { id: 'finance', label: 'FINANCE', href: '/finance', requiredRoles: ['sponsor'] },
  { id: 'notary', label: 'NOTARY', href: '/notary', requiredRoles: ['notaire'] },
];

type ViewId = 'exceptions' | 'all_lots';

const TABS: { id: ViewId; label: string }[] = [
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'all_lots', label: 'Tous les lots' },
];

export interface AppProps {
  userRoles?: string[];
}

export function App({ userRoles = ['constructeur'] }: AppProps) {
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
      modules={MODULES}
      userRoles={userRoles}
      activeModuleId="build"
      breadcrumbs={[{ label: 'BUILD' }]}
    >
      <nav aria-label="Sections BUILD">
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

      {activeTab === 'exceptions' && <ExceptionsView onViewLotInTable={handleViewLotInTable} />}
      {activeTab === 'all_lots' && <AllLotsView initialSearch={lotSearchFilter} />}
    </AppShell>
  );
}
