import { useEffect, useState } from 'react';

import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { getCachedMissions, getDraftForMission } from '../db/repository';
import type { Mission, SyncStatus } from '../db/types';

export interface MissionsListViewProps {
  onSelectMission: (missionId: string) => void;
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
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {missions.map((mission) => (
          <li key={mission.id}>
            <button
              type="button"
              onClick={() => onSelectMission(mission.id)}
              style={{ width: '100%', textAlign: 'left', padding: '12px', minHeight: '44px' }}
            >
              <strong>{mission.lotName}</strong> — {mission.assetName}
              <div>{mission.programName} · {mission.milestoneLabel}</div>
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
