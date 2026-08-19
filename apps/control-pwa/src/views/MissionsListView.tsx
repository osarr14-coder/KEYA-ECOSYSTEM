import { useEffect, useState } from 'react';

import { semanticColors } from '@keya/design-system';

import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { getCachedMissions, getDraftForMission } from '../db/repository';
import type { Mission, SyncStatus } from '../db/types';

export interface MissionsListViewProps {
  onSelectMission: (missionId: string) => void;
}

/**
 * Ticket 014 — friction du rapport bout-en-bout : une première inspection
 * et une mission de suivi (réserve déjà ouverte sur ce lot) s'affichaient
 * de façon strictement identique — rien ne permettait à l'inspecteur de
 * savoir, avant d'ouvrir la mission, laquelle des deux il avait devant lui.
 * PAS `StatusBadge` du design system : le type de mission n'est pas un des
 * 5 niveaux Visible Trust (`TrustLevel`), même raisonnement que
 * `SyncStatusIndicator`/`AlertBanner` vs `StatusBadge` (tickets 007/008/010)
 * — un composant local suffit, aucun second consommateur ne le réclame.
 * Référence courte de la réserve (8 premiers caractères de son UUID,
 * convention déjà utilisée par ce type d'identifiant dans l'app) plutôt que
 * `Reserve.description`, qui n'est en pratique jamais renseigné nulle part
 * dans le code actuel (toujours vide) — l'exposer aurait été trompeur.
 */
// Ticket 024 (audit accessibilite) - reprend le token partage du design
// system plutot qu'une couleur redefinie ici en dur (meme piege deja
// documente pour #E5E7EB, ticket 023).
const MISSION_TYPE_STYLE = { fontSize: '13px', color: semanticColors.neutral.textMuted };

function MissionTypeIndicator({ mission }: { mission: Mission }) {
  if (!mission.reserveId) {
    return <span data-testid="mission-type" data-mission-type="first" style={MISSION_TYPE_STYLE}>Première inspection</span>;
  }
  return (
    <span data-testid="mission-type" data-mission-type="follow-up" style={MISSION_TYPE_STYLE}>
      Mission de suivi — Réserve #{mission.reserveId.slice(0, 8)}
    </span>
  );
}

/**
 * Ticket 012 : la liste vient du cache local (`getCachedMissions`),
 * alimenté par `sync/syncEngine.ts::refreshMissions` au retour du réseau —
 * jamais `MOCK_MISSIONS` (ticket 010, retiré). Un cache vide (avant la
 * première synchronisation, ou aucune mission réellement affectée) affiche
 * un état vide explicite, pas une liste figée.
 */
export function MissionsListView({ onSelectMission }: MissionsListViewProps) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [statusByMission, setStatusByMission] = useState<Record<string, SyncStatus>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cachedMissions = await getCachedMissions();
      if (cancelled) return;
      setMissions(cachedMissions);

      const entries = await Promise.all(
        cachedMissions.map(async (mission) => {
          const draft = await getDraftForMission(mission.id);
          return [mission.id, draft?.syncStatus] as const;
        }),
      );
      if (cancelled) return;
      const next: Record<string, SyncStatus> = {};
      for (const [missionId, status] of entries) {
        if (status) next[missionId] = status;
      }
      setStatusByMission(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-label="Mes missions">
      <h1>Mes missions</h1>
      {missions.length === 0 && <p>Aucune mission pour le moment.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {missions.map((mission) => (
          <li key={mission.id}>
            <button
              type="button"
              onClick={() => onSelectMission(mission.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px',
                minHeight: '44px',
                border: `1px solid ${semanticColors.neutral.border}`,
                borderRadius: '8px',
                background: 'white',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <strong>{mission.lotName}</strong> — {mission.assetName}
              <div>{mission.programName} · {mission.milestoneLabel}</div>
              <div><MissionTypeIndicator mission={mission} /></div>
              {statusByMission[mission.id] && (
                <SyncStatusIndicator status={statusByMission[mission.id]} />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
