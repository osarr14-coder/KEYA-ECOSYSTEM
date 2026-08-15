import { useEffect, useState } from 'react';

import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { MOCK_MISSIONS } from '../db/missions';
import { getDraftForMission } from '../db/repository';
import type { SyncStatus } from '../db/types';

export interface MissionsListViewProps {
  onSelectMission: (missionId: string) => void;
}

export function MissionsListView({ onSelectMission }: MissionsListViewProps) {
  const [statusByMission, setStatusByMission] = useState<Record<string, SyncStatus>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        MOCK_MISSIONS.map(async (mission) => {
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
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {MOCK_MISSIONS.map((mission) => (
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
