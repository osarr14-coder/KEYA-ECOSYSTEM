import { useSyncExternalStore } from 'react';

import { notifyDataChanged } from './useApiResource';

/**
 * Lot 5 (PO-2026-09-29-01) — archive consultée dans cet onglet du
 * back-office (administrateur, gestionnaire). Le client API envoie son code
 * dans `X-Demo-Instance-View` ; sans archive, l'instance active est lue.
 * Mémorisée pour l'onglet seulement (`sessionStorage`) : une nouvelle
 * fenêtre repart sur l'instance active.
 */
export interface ViewedArchive {
  code: string;
  archived_at: string | null;
}

export const ARCHIVE_READ_ONLY = 'Instance archivée — lecture seule : aucune modification possible.';
const STORAGE_KEY = 'keya:viewed-archive';
const listeners = new Set<() => void>();

function read(): ViewedArchive | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ViewedArchive) : null;
  } catch {
    return null;
  }
}

let current: ViewedArchive | null = read();

export function getViewedArchive(): ViewedArchive | null {
  return current;
}

export function setViewedArchive(next: ViewedArchive | null): void {
  current = next;
  try {
    if (next) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Stockage indisponible : l'état vit en mémoire pour la session.
  }
  listeners.forEach((listener) => listener());
  // Tous les écrans affichés relisent aussitôt l'instance choisie.
  notifyDataChanged();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useViewedArchive(): ViewedArchive | null {
  return useSyncExternalStore(subscribe, getViewedArchive, getViewedArchive);
}
