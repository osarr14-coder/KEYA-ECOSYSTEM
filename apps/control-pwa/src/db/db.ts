import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

import type { InspectionDraft, Mission } from './types';

interface ControlDB extends DBSchema {
  inspection_drafts: {
    key: string;
    value: InspectionDraft;
    indexes: { 'by-mission': string; 'by-sync-status': string };
  };
  missions: {
    key: string;
    value: Mission;
  };
}

const DATABASE_NAME = 'keya-control';
// v2 (ticket 012) : nouvel object store `missions, pour mettre en cache la
// vraie liste récupérée via `GET /api/control/missions/` (remplace
// `MOCK_MISSIONS`, ticket 010) — nécessite un `upgrade()`, jamais une
// simple réutilisation de la v1 (un nouvel object store n'apparaît qu'à
// travers une transition de version explicite, voir `idb`).
const DATABASE_VERSION = 2;

/**
 * Une connexion par appel — volontairement PAS un singleton mis en cache
 * dans une variable de module : le test de persistance
 * (`repository.test.ts`) doit pouvoir fermer une connexion puis en ouvrir
 * une NOUVELLE pour prouver une vraie relecture depuis le disque (simulée
 * par `fake-indexeddb`), pas juste relire une référence JS déjà en mémoire.
 * Un singleton aurait rendu ce test trivialement vrai sans rien prouver.
 */
export function openControlDatabase(): Promise<IDBPDatabase<ControlDB>> {
  return openDB<ControlDB>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('inspection_drafts', { keyPath: 'id' });
        store.createIndex('by-mission', 'missionId');
        store.createIndex('by-sync-status', 'syncStatus');
      }
      if (oldVersion < 2) {
        db.createObjectStore('missions', { keyPath: 'id' });
      }
    },
  });
}

export type { ControlDB };
