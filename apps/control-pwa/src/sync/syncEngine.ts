import { createApiClient, type ApiClient } from '../api/client';
import { getAllDrafts, getCachedMission, getDraft, patchDraft, saveMissions } from '../db/repository';
import type { InspectionDraft, LocalPhoto } from '../db/types';
import { compressImage } from '../media/compressImage';
import { computeNextRetryAt } from './backoff';

const RETRY_POLL_INTERVAL_MS = 15000;

function isDue(nextRetryAt: string | null): boolean {
  return !nextRetryAt || new Date(nextRetryAt).getTime() <= Date.now();
}

/** Ticket 012 : lit le cache local (`missions`, alimenté par
 * `refreshMissions` ci-dessous), jamais `MOCK_MISSIONS` (retiré). Une
 * mission pas encore vue par ce cycle réseau — ou jamais reçue par le
 * serveur — retourne simplement `null` : `syncDraft` n'a alors rien à
 * synchroniser pour ce brouillon tant que la liste réelle n'est pas connue.
 */
async function findMission(missionId: string) {
  return (await getCachedMission(missionId)) ?? null;
}

function formatNote(draft: InspectionDraft): string {
  const checklistLines = draft.checklist
    .map((item) => `${item.label} : ${item.checked ? 'OK' : 'Non vérifié'}`)
    .join('\n');
  return `Checklist :\n${checklistLines}\n\nCommentaire : ${draft.comment}`;
}

/**
 * File média (ticket 010, passe 2) : chaque photo a son propre statut et
 * son propre backoff, indépendant de la file de données ci-dessous —
 * l'échec d'UNE photo ne modifie jamais le sort des autres ni celui de la
 * checklist/commentaire/décision (voir `syncDraft`).
 */
async function syncPhotos(
  draft: InspectionDraft, organizationId: string, apiClient: ApiClient,
): Promise<{ photos: LocalPhoto[]; changed: boolean }> {
  const eligible = draft.photos.filter(
    (photo) => photo.mediaSyncStatus !== 'synced' && isDue(photo.nextRetryAt),
  );
  if (eligible.length === 0) return { photos: draft.photos, changed: false };

  const eligibleIds = new Set(eligible.map((photo) => photo.id));
  const markedSyncing = draft.photos.map((photo) => (
    eligibleIds.has(photo.id) ? { ...photo, mediaSyncStatus: 'syncing' as const } : photo
  ));
  await patchDraft({ ...draft, photos: markedSyncing });

  const photos = await Promise.all(markedSyncing.map(async (photo): Promise<LocalPhoto> => {
    if (!eligibleIds.has(photo.id)) return photo;
    try {
      const compressed = await compressImage(photo.blob);
      const remoteDocumentId = await apiClient.syncDocument({
        organizationId,
        file: compressed,
        fileName: photo.fileName,
        category: 'photo_inspection',
        source: 'mobile_app_photo',
        correlationId: draft.correlationId,
      });
      return { ...photo, mediaSyncStatus: 'synced', remoteDocumentId, retryCount: 0, nextRetryAt: null };
    } catch {
      const retryCount = photo.retryCount + 1;
      return {
        ...photo, mediaSyncStatus: 'failed', retryCount, nextRetryAt: computeNextRetryAt(retryCount),
      };
    }
  }));
  return { photos, changed: true };
}

/**
 * Regroupe les documents déjà synchronisés en une `Evidence` — seulement
 * une fois que TOUTES les photos connues sont `synced` (pas de "evidence
 * partielle" : voir apps/control/services.py::sync_evidence, qui reçoit la
 * liste complète en un seul appel). Un échec ici est retenté au prochain
 * cycle SANS jamais empêcher la synchronisation des données ci-dessous.
 */
async function syncEvidenceIfReady(
  draft: InspectionDraft, photos: LocalPhoto[], organizationId: string, workDeclarationId: string,
  apiClient: ApiClient,
): Promise<string | null> {
  if (draft.evidenceId) return draft.evidenceId;
  if (photos.length === 0) return null;
  if (!photos.every((photo) => photo.mediaSyncStatus === 'synced')) return null;

  try {
    return await apiClient.syncEvidence({
      organizationId,
      workDeclarationId,
      documentIds: photos.map((photo) => photo.remoteDocumentId as string),
      correlationId: draft.correlationId,
    });
  } catch {
    return null;
  }
}

/**
 * Verrou PAR BROUILLON (ticket 015) : un cycle de synchro périodique qui
 * dépasse l'intervalle de sondage (15s, voir `startSyncEngine`) peut
 * chevaucher un cycle encore en cours pour ce MÊME brouillon — sans ce
 * verrou, les deux enverraient chacun leur propre instantané au serveur,
 * potentiellement périmé l'un par rapport à l'autre (le second envoi peut
 * avoir lu le brouillon AVANT que le premier n'ait fini de le faire
 * progresser). Jamais un verrou global : d'autres brouillons continuent de
 * se synchroniser normalement pendant qu'un seul est retenu ici.
 */
const draftsInFlight = new Set<string>();

/**
 * Synchronise UN brouillon : file média puis file de données — la cible de
 * l'Inspection est TOUJOURS `work_declaration` (jamais `evidence`),
 * précisément pour que la checklist/le commentaire/la décision ne dépendent
 * jamais de la réussite d'un upload photo (voir CLAUDE.md, addendum
 * passe 2). Jamais d'abandon silencieux : toute tentative échouée
 * reprogramme un `nextRetryAt` futur plutôt que de laisser l'item
 * disparaître de la file.
 *
 * `syncStatus === 'syncing'` est aussi éligible à une nouvelle tentative
 * (pas seulement `pending`) : un item resté `syncing` ne peut venir que
 * d'une interruption (app fermée pendant l'appel réseau) — le laisser
 * bloqué indéfiniment dans cet état serait, de fait, un abandon silencieux.
 */
export async function syncDraft(draft: InspectionDraft, apiClient: ApiClient): Promise<InspectionDraft> {
  // Vérifié et posé EN TOUT PREMIER, avant tout `await` : un appel qui
  // chevauche un appel déjà en cours pour ce brouillon (voir `runSyncCycle`,
  // qui peut en déclencher un par cycle qui se chevauche) trouve donc
  // TOUJOURS ce verrou déjà posé — aucune fenêtre de course possible pour
  // le vérifier, deux appels synchrones voient l'un l'autre de façon fiable
  // (JS n'exécute jamais deux appels de fonction en parallèle). Ce
  // brouillon est déjà pris en charge ailleurs : ne rien faire, jamais une
  // resynchro fantôme — le prochain sondage périodique retentera si besoin.
  if (draftsInFlight.has(draft.id)) return draft;
  draftsInFlight.add(draft.id);
  try {
    // Ticket 015 ter : le verrou ci-dessus empêche deux appels de tourner
    // EN PARALLÈLE, mais ne dit rien de la FRAÎCHEUR du `draft` reçu en
    // paramètre — `runSyncCycle` le lit via `getAllDrafts()` avant même
    // d'appeler cette fonction, donc un second cycle a pu lire ce brouillon
    // AVANT qu'un premier, déjà en cours à ce moment-là, n'ait fini d'écrire
    // son propre résultat. Une fois le verrou du premier relâché, ce second
    // appel n'est plus bloqué — mais son `draft` reste périmé (ex. une photo
    // que le premier vient de synchroniser y apparaît encore `pending`),
    // provoquant un réupload (Document dupliqué, Evidence orpheline). Relit
    // donc l'état RÉEL depuis IndexedDB, SOUS le verrou, avant tout
    // traitement — jamais se fier à l'instantané reçu en paramètre seul.
    const current = (await getDraft(draft.id)) ?? draft;
    return await syncDraftUnlocked(current, apiClient);
  } finally {
    draftsInFlight.delete(draft.id);
  }
}

async function syncDraftUnlocked(draft: InspectionDraft, apiClient: ApiClient): Promise<InspectionDraft> {
  const mission = await findMission(draft.missionId);
  if (!mission) return draft;

  const { photos, changed: photosChanged } = await syncPhotos(draft, mission.organizationId, apiClient);
  const evidenceId = await syncEvidenceIfReady(
    draft, photos, mission.organizationId, mission.workDeclarationId, apiClient,
  );

  let next: InspectionDraft = { ...draft, photos, evidenceId };
  if (photosChanged || evidenceId !== draft.evidenceId) {
    next = await patchDraft(next);
  }

  const shouldAttemptData = (
    (next.syncStatus === 'pending' || next.syncStatus === 'syncing') && isDue(next.nextRetryAt)
    // Ticket 013 (bug 1) : `decision` reste `null` tant que l'inspecteur n'a
    // pas explicitement choisi Conforme/Réserve — un brouillon dans cet état
    // ne doit JAMAIS être envoyé, sous peine de soumettre une décision que
    // personne n'a prise (le `null` tombait silencieusement dans la branche
    // « conforme » avant cette correction). La checklist/le commentaire/les
    // photos restent synchronisables indépendamment (voir `syncPhotos`/
    // `syncEvidenceIfReady` ci-dessus, non gatées ici) — seule la création
    // de l'Inspection elle-même attend une décision explicite.
    && next.decision !== null
  );
  if (!shouldAttemptData) return next;

  next = await patchDraft({ ...next, syncStatus: 'syncing' });
  try {
    const result = await apiClient.syncInspection({
      organizationId: mission.organizationId,
      workDeclarationId: mission.workDeclarationId,
      outcome: next.decision === 'reserve' ? 'avec_reserve' : 'conforme',
      note: formatNote(next),
      // Ticket 013 (bug 3) : sans ce champ, aucune inspection de suivi
      // soumise depuis l'app réelle n'était jamais liée à une réserve — elle
      // restait ouverte indéfiniment quel que soit l'outcome envoyé. Vient
      // du cache de missions (`mission.reserveId`, voir
      // `apps.inspections.services.list_missions_for_inspector`), jamais du
      // brouillon lui-même : c'est la MISSION affectée qui porte cette
      // information, pas une saisie de l'inspecteur.
      reserveId: mission.reserveId,
      correlationId: next.correlationId,
      knownLatestEventId: next.knownLatestEventId,
    });

    if (result.status === 'conflict') {
      next = await patchDraft({
        ...next,
        syncStatus: 'conflict',
        conflict: {
          currentEventSource: result.currentEvent?.source ?? null,
          currentEventCreatedAt: result.currentEvent?.createdAt ?? null,
        },
      });
    } else {
      next = await patchDraft({
        ...next,
        syncStatus: 'synced',
        serverTimestamp: result.inspection?.created_at ?? new Date().toISOString(),
        retryCount: 0,
        nextRetryAt: null,
        // Ticket 013 (bug 2) : sans cette ligne, `knownLatestEventId`
        // restait figé à sa valeur d'origine (souvent `null`) pour
        // toujours — toute tentative suivante légitime sur cette même
        // cible se faisait alors rejeter en conflit à tort, indéfiniment.
        knownLatestEventId: result.latestEventId ?? next.knownLatestEventId,
      });
    }
  } catch {
    const retryCount = next.retryCount + 1;
    next = await patchDraft({
      ...next, syncStatus: 'pending', retryCount, nextRetryAt: computeNextRetryAt(retryCount),
    });
  }

  return next;
}

/**
 * Un passage sur TOUS les brouillons connus — appelé au retour du réseau
 * (`online`) et périodiquement tant que la connexion reste active (voir
 * `startSyncEngine`). `conflict` n'est JAMAIS retenté ici : `syncDraft` ne
 * relance une tentative de synchronisation des données que pour un item
 * `pending`/`syncing` — un conflit reste visible jusqu'à une action
 * explicite de l'inspecteur (critère d'acceptation le plus important de
 * cette passe).
 */
export async function runSyncCycle(apiClient: ApiClient): Promise<void> {
  const drafts = await getAllDrafts();
  for (const draft of drafts) {
    const hasPendingPhoto = draft.photos.some((photo) => photo.mediaSyncStatus !== 'synced');
    const hasPendingData = draft.syncStatus === 'pending' || draft.syncStatus === 'syncing';
    if (!hasPendingPhoto && !hasPendingData) continue;
    await syncDraft(draft, apiClient);
  }
}

/**
 * Récupère la vraie liste de missions (`GET /api/control/missions/`,
 * ticket 012) et la met en cache localement — remplace `MOCK_MISSIONS`
 * (ticket 010). Échec silencieux ici (pas de compteur/backoff dédié,
 * contrairement à `syncDraft`) : le sondage périodique de `startSyncEngine`
 * retentera naturellement au cycle suivant, la liste de missions n'ayant
 * pas la même urgence qu'une saisie d'inspecteur à ne jamais perdre.
 */
export async function refreshMissions(apiClient: ApiClient): Promise<void> {
  try {
    const missions = await apiClient.listMissions();
    await saveMissions(missions);
  } catch {
    // Retenté au prochain passage de `runIfOnline` — voir docstring.
  }
}

/** Même convention que `apps/build`/`apps/home` (ticket 008/009) : aucune UI
 * de connexion frontend n'existe encore, jeton lu depuis `localStorage` en
 * attendant un futur ticket d'authentification. */
export function createDefaultApiClient(): ApiClient {
  return createApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
    getAccessToken: () => localStorage.getItem('keya_access_token'),
  });
}

/**
 * Démarre le moteur de synchronisation : un passage immédiat si déjà en
 * ligne au démarrage, un passage à chaque transition `offline→online`, et
 * un sondage périodique tant que la connexion reste active — un item en
 * attente de backoff n'aurait sinon plus aucune chance d'être retenté avant
 * la PROCHAINE transition `offline→online`, qui peut ne jamais survenir si
 * le réseau ne coupe jamais réellement pendant la session. Retourne une
 * fonction d'arrêt, appelée au démontage de `<App />` (voir App.tsx).
 */
export function startSyncEngine(apiClient: ApiClient): () => void {
  let stopped = false;

  function runIfOnline() {
    if (stopped || !navigator.onLine) return;
    // Missions rafraîchies AVANT le cycle de synchronisation des
    // brouillons : un brouillon dont la mission vient d'apparaître au
    // cache (jamais vue avant ce cycle) doit pouvoir se synchroniser dans
    // la MÊME passe, pas seulement à la suivante.
    void refreshMissions(apiClient).then(() => runSyncCycle(apiClient));
  }

  window.addEventListener('online', runIfOnline);
  const intervalId = setInterval(runIfOnline, RETRY_POLL_INTERVAL_MS);
  runIfOnline();

  return () => {
    stopped = true;
    window.removeEventListener('online', runIfOnline);
    clearInterval(intervalId);
  };
}
