import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

import type { InspectionDraft } from './types';

interface ControlDB extends DBSchema {
  inspection_drafts: {
    key: string;
    value: InspectionDraft;
    indexes: { 'by-mission': string; 'by-sync-status': string };
  };
}

const DATABASE_NAME = 'keya-control';
const DATABASE_VERSION = 1;

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
    upgrade(db) {
      const store = db.createObjectStore('inspection_drafts', { keyPath: 'id' });
      store.createIndex('by-mission', 'missionId');
      store.createIndex('by-sync-status', 'syncStatus');
    },
  });
}

export type { ControlDB };
