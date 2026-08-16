import { saveMissions } from '../db/repository';
import type { Mission } from '../db/types';

/**
 * Ticket 012 : `MOCK_MISSIONS` (ticket 010) a été retiré du CODE DE
 * PRODUCTION — remplacé par un vrai fetch (`GET /api/control/missions/`,
 * voir `sync/syncEngine.ts::refreshMissions`). Ces fixtures ne servent
 * plus qu'aux TESTS, pour peupler le cache local (`saveMissions`) sans
 * dépendre du réseau — même contenu que l'ancien `MOCK_MISSIONS`, pour ne
 * pas casser les libellés déjà attendus par les tests existants
 * (« Lot 12 », etc.).
 */
export const FIXTURE_MISSIONS: Mission[] = [
  {
    id: 'mission-1', lotName: 'Lot 12', assetName: 'Résidence Ker',
    programName: 'Programme Keur Massar', milestoneLabel: 'Fondations',
    organizationId: '00000000-0000-0000-0000-0000000000a1',
    workDeclarationId: '00000000-0000-0000-0000-0000000000b1',
    completed: false,
    reserveId: null,
    reserveLatestEventId: null,
  },
  {
    id: 'mission-2', lotName: 'Lot 07', assetName: 'Résidence Ker',
    programName: 'Programme Keur Massar', milestoneLabel: 'Gros œuvre',
    organizationId: '00000000-0000-0000-0000-0000000000a1',
    workDeclarationId: '00000000-0000-0000-0000-0000000000b2',
    completed: false,
    reserveId: null,
    reserveLatestEventId: null,
  },
  {
    id: 'mission-3', lotName: 'Lot 03', assetName: 'Villa Almadies',
    programName: 'Programme Almadies Sud', milestoneLabel: 'Second œuvre',
    organizationId: '00000000-0000-0000-0000-0000000000a2',
    workDeclarationId: '00000000-0000-0000-0000-0000000000b3',
    completed: false,
    reserveId: null,
    reserveLatestEventId: null,
  },
];

export async function seedFixtureMissions(missions: Mission[] = FIXTURE_MISSIONS): Promise<void> {
  await saveMissions(missions);
}
