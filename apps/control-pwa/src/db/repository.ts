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
    knownLatestEventId: null,
    retryCount: 0,
    nextRetryAt: null,
    conflict: null,
    evidenceId: null,
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

/**
 * Écrit le brouillon SANS reposer `deviceTimestamp` — réservé aux
 * transitions pilotées par le moteur de synchronisation (`syncStatus`,
 * horodatage serveur, compteurs/horaires de tentative, statut par photo...).
 * `saveDraft` reste la SEULE fonction utilisée pour une saisie de
 * l'inspecteur : c'est elle qui fait foi pour `deviceTimestamp` (voir son
 * propre docstring) — un aller-retour réseau ne doit jamais la modifier,
 * sous peine de casser le critère d'acceptation central de la passe 1
 * (l'horodatage device reflète la dernière saisie HUMAINE, rien d'autre).
 */
export async function patchDraft(draft: InspectionDraft): Promise<InspectionDraft> {
  const db = await openControlDatabase();
  try {
    await db.put('inspection_drafts', draft);
  } finally {
    db.close();
  }
  return draft;
}

/**
 * Supprime un brouillon — utilisé UNIQUEMENT par la résolution explicite
 * d'un conflit (ticket 010, passe 2) : l'inspecteur choisit sciemment
 * d'abandonner sa saisie devenue obsolète plutôt que de la voir écrasée
 * silencieusement. Jamais appelé automatiquement par le moteur de
 * synchronisation lui-même.
 */
export async function deleteDraft(id: string): Promise<void> {
  const db = await openControlDatabase();
  try {
    await db.delete('inspection_drafts', id);
  } finally {
    db.close();
  }
}
