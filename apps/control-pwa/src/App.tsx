import { useEffect, useMemo, useState } from 'react';

import {
  AlertBanner, brandColors, typography, useOnlineStatus,
} from '@keya/design-system';

import { createDefaultApiClient, startSyncEngine } from './sync/syncEngine';
import { InspectionFormView } from './views/InspectionFormView';
import { MissionsListView } from './views/MissionsListView';

/**
 * `AlertBanner` (ticket 007/008) réutilisé tel quel pour l'indicateur hors
 * ligne — pas `AppShell` : conçu pour un layout desktop dense/confortable
 * (sidebar + topbar), pas pour un écran tactile 360-430px. Voir CLAUDE.md,
 * section CONTROL PWA.
 *
 * `useOnlineStatus` vivait ici même (ticket 010 passe 2) — promu au design
 * system au ticket F-033 (vague 2), désormais aussi consommé par HOME/
 * BUILD/apps-web : ce fichier importe la même implémentation UNIQUE,
 * jamais une copie locale.
 *
 * Ticket F-054 (refonte visuelle, suite de F-053) — bandeau de marque
 * compact ajouté (badge K+ dégradé + "KEYA"), MÊME div racine inchangée
 * (maxWidth/minWidth/margin/padding) : ce bandeau est un ENFANT
 * supplémentaire de cette div, jamais un nouveau wrapper autour d'elle —
 * `App.test.tsx` (« interface tactile 360-430px ») cherche le plus proche
 * ancêtre <div> du texte "Mes missions" et vérifie CES styles précis,
 * casserait si un div intermédiaire s'intercalait.
 */
function BrandBar() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '12px',
        paddingBottom: '10px',
        borderBottom: `2px solid ${brandColors.gold}`,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '26px',
          height: '26px',
          borderRadius: '8px',
          background: `linear-gradient(135deg, ${brandColors.gold}, #E4C878)`,
          color: brandColors.navy,
          fontWeight: 700,
          fontFamily: typography.headingFontFamily,
          fontSize: '13px',
          flexShrink: 0,
        }}
      >
        K+
      </span>
      <span style={{ fontFamily: typography.headingFontFamily, fontWeight: 600, fontSize: '15px' }}>KEYA</span>
      <span style={{ fontSize: '11px', color: brandColors.gold, fontWeight: 600, letterSpacing: '0.05em' }}>
        CONTROL
      </span>
    </div>
  );
}
export function App() {
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  // Un seul client pour toute la durée de vie de l'app — le moteur de
  // synchronisation (ticket 010, passe 2) s'appuie sur `window`
  // (événement `online`) et `navigator.onLine`, jamais sur `isOnline`
  // ci-dessus (état React, redondant et non nécessaire ici). Démarré/arrêté
  // avec le cycle de vie de `<App />`, pas plus tôt/tard.
  const apiClient = useMemo(() => createDefaultApiClient(), []);
  useEffect(() => startSyncEngine(apiClient), [apiClient]);

  return (
    <div style={{ maxWidth: '430px', minWidth: '360px', margin: '0 auto', padding: '12px' }}>
      <BrandBar />
      {!isOnline && (
        <div style={{ marginBottom: '12px' }}>
          <AlertBanner title="Hors ligne">
            Vos saisies sont enregistrées sur cet appareil et seront synchronisées à la reconnexion.
          </AlertBanner>
        </div>
      )}

      {selectedMissionId === null ? (
        <MissionsListView onSelectMission={setSelectedMissionId} />
      ) : (
        <InspectionFormView
          missionId={selectedMissionId}
          onBack={() => setSelectedMissionId(null)}
        />
      )}
    </div>
  );
}
