import { useEffect, useMemo, useState } from 'react';

import {
  AlertBanner, BRAND_NAME, BRAND_GRADIENT, Icon, brandColors, logoutToLoginScreen, typography, useOnlineStatus,
} from '@keya/design-system';

import { OFFLINE_MODE_ENABLED } from './config';
import { getAllDrafts, saveMissions } from './db/repository';
import { createDefaultApiClient, startSyncEngine } from './sync/syncEngine';
import { InspectionFormView } from './views/InspectionFormView';
import { MissionReviewView } from './views/MissionReviewView';
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
 *
 * Ticket F-056 (suite F-053/054/055) — révision de la doctrine 17.3 :
 * fond en dégradé navy/or (`BRAND_GRADIENT`, même traitement que le
 * bandeau `<header>` `brand` d'AppShell sur les 3 autres apps), pas
 * seulement une bordure en bas comme avant ce ticket. PAS un bandeau
 * plein bord comme AppShell (padding `12px` de la div racine ci-dessous
 * verrouillé par le même test « interface tactile » cité plus haut,
 * jamais retiré pour ce ticket) : encart arrondi à la place, même esprit
 * appliqué à la contrainte structurelle existante.
 */
function BrandBar() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        // PO-2026-09-27-20 (V05) : en-tête pleine largeur, plus d'encart
        // flottant arrondi (les marges négatives compensent le padding de
        // la racine, verrouillé par le test « interface tactile »).
        margin: '-12px -12px 12px',
        padding: '10px 12px 10px 14px',
        borderRadius: 0,
        background: BRAND_GRADIENT,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '6px',
          background: brandColors.gold,
          color: brandColors.navy,
          fontWeight: 600,
          fontFamily: typography.headingFontFamily,
          fontSize: '14px',
          flexShrink: 0,
        }}
      >
        K+
      </span>
      {/* Audit UI R1 (M05) : « KEYIMMO AFRIC » dans toutes les interfaces. */}
      <span style={{ fontFamily: typography.headingFontFamily, fontWeight: 600, fontSize: '16px', color: '#FFFFFF' }}>
        {BRAND_NAME}
      </span>
      <span style={{ fontSize: '12px', color: '#D5DCE8', fontWeight: 600 }}>
        Contrôle
      </span>
      <LogoutButton />
    </div>
  );
}

/**
 * Ticket F-070 — déconnexion volontaire (aucune n'existait). Une saisie
 * d'inspection non encore synchronisée vit sur cet appareil : l'inspecteur
 * est prévenu avant de partir (elle reste stockée localement et repartira à
 * la prochaine session de ce même compte). Le cache des missions est vidé :
 * le compte suivant ne doit jamais voir celles d'un autre contrôleur.
 */
function LogoutButton() {
  async function handleLogout() {
    const drafts = await getAllDrafts().catch(() => []);
    const unsynced = drafts.filter((draft) => draft.syncStatus !== 'synced');
    if (unsynced.length > 0 && !window.confirm(
      `${unsynced.length} saisie(s) ne sont pas encore synchronisées sur le serveur. Se déconnecter quand même ?`,
    )) return;
    await saveMissions([]).catch(() => undefined);
    logoutToLoginScreen();
  }

  return (
    <button
      type="button"
      onClick={() => { void handleLogout(); }}
      style={{
        marginLeft: 'auto',
        border: 'none',
        background: 'transparent',
        color: '#FFFFFF',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        minHeight: '44px',
        font: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      }}
    >
      <Icon name="log-out" size={18} />
      Se déconnecter
    </button>
  );
}
export interface AppProps {
  /** Audit UI R1 (K04) : `false` par défaut (`OFFLINE_MODE_ENABLED`) — avis
   * en ligne. `true` ne sert qu'à exercer le code hors ligne conservé. */
  offlineMode?: boolean;
}

export function App({ offlineMode = OFFLINE_MODE_ENABLED }: AppProps = {}) {
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  // Un seul client pour toute la durée de vie de l'app — le moteur de
  // synchronisation (ticket 010, passe 2) s'appuie sur `window`
  // (événement `online`) et `navigator.onLine`, jamais sur `isOnline`
  // ci-dessus (état React, redondant et non nécessaire ici). Démarré/arrêté
  // avec le cycle de vie de `<App />`, pas plus tôt/tard.
  const apiClient = useMemo(() => createDefaultApiClient(), []);
  useEffect(() => (offlineMode ? startSyncEngine(apiClient) : undefined), [apiClient, offlineMode]);

  return (
    <div style={{ maxWidth: '430px', minWidth: '360px', margin: '0 auto', padding: '12px' }}>
      <BrandBar />
      {!isOnline && (
        <div style={{ marginBottom: '12px' }}>
          <AlertBanner title="Hors ligne">
            {offlineMode
              ? 'Vos saisies sont enregistrées sur cet appareil et seront synchronisées à la reconnexion.'
              : 'La connexion est nécessaire pour consulter les missions et enregistrer un avis (date serveur).'}
          </AlertBanner>
        </div>
      )}

      {selectedMissionId === null && (
        <MissionsListView
          onSelectMission={setSelectedMissionId}
          loadMissions={offlineMode ? undefined : apiClient.listMissions}
        />
      )}
      {selectedMissionId !== null && offlineMode && (
        <InspectionFormView
          missionId={selectedMissionId}
          onBack={() => setSelectedMissionId(null)}
        />
      )}
      {selectedMissionId !== null && !offlineMode && (
        <MissionReviewView
          missionId={selectedMissionId}
          api={apiClient}
          onBack={() => setSelectedMissionId(null)}
        />
      )}
    </div>
  );
}
