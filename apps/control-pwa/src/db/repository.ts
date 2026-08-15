import { openControlDatabase } from './db';
import type { ChecklistItemState, InspectionDraft } from './types';

/**
 * Un brouillon neuf, EN MÉMOIRE seulement — n'écrit rien en IndexedDB tant
 * qu'aucune saisie réelle n'a eu lieu (éviter de polluer la base d'un
 * brouillon vide si l'inspecteur ouvre une mission puis la quitte aussitôt).
 * Le `correlationId` est généré ICI, dès la création — condition du ticket
 * pour la traçabilité de bout en bout côté serveur (passe 2), même si rien
 * n'est encore synchronisé cette passe.
 */
export function createEmptyDraft(missionId: string, checklistTemplate: ChecklistItemState[]): InspectionDraft {
  const correlationId = crypto.randomUUID();
  return {
    id: correlationId,
    correlationId,
    missionId,
    checklist: checklistTemplate.map((item) => ({ ...item })),
    comment: '',
    decision: null,
    photos: [],
    deviceTimestamp: new Date().toISOString(),
    serverTimestamp: null,
    syncStatus: 'pending',
  };
}

/**
 * Écrit le brouillon en IndexedDB — AVANT toute tentative réseau, il n'y en
 * a d'ailleurs aucune dans cette passe (voir `apps/control-pwa` dans
 * CLAUDE.md). `deviceTimestamp` est reposé à l'heure de l'appareil à CHAQUE
 * sauvegarde : c'est la dernière saisie qui fait foi. Une connexion neuve à
 * chaque appel (voir `db.ts`) — jamais de singleton mis en cache.
 */
export async function saveDraft(draft: InspectionDraft): Promise<InspectionDraft> {
  const toPersist: InspectionDraft = { ...draft, deviceTimestamp: new Date().toISOString() };
  const db = await openControlDatabase();
  try {
    await db.put('inspection_drafts', toPersist);
  } finally {
    db.close();
  }
  return toPersist;
}

export async function getDraft(id: string): Promise<InspectionDraft | undefined> {
  const db = await openControlDatabase();
  try {
    return await db.get('inspection_drafts', id);
  } finally {
    db.close();
  }
}

/** Un brouillon existant pour cette mission, s'il y en a déjà un — au plus
 * un par mission dans cette passe (l'inspecteur reprend sa saisie plutôt
 * que d'en recommencer une nouvelle). */
export async function getDraftForMission(missionId: string): Promise<InspectionDraft | undefined> {
  const db = await openControlDatabase();
  try {
    return await db.getFromIndex('inspection_drafts', 'by-mission', missionId);
  } finally {
    db.close();
  }
}

export async function getAllDrafts(): Promise<InspectionDraft[]> {
  const db = await openControlDatabase();
  try {
    return await db.getAll('inspection_drafts');
  } finally {
    db.close();
  }
}
