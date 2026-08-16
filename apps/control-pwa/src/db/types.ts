/**
 * Ticket 010 (passe 1) — modèle de données CÔTÉ APPAREIL, distinct du
 * modèle backend (`apps/inspections/models.py`) : tant qu'aucune
 * synchronisation n'existe (passe 2), ce brouillon local n'a pas
 * d'équivalent serveur, seulement une intention de ce qu'il deviendra.
 */

/**
 * Statut de synchronisation d'un item — les 4 valeurs demandées par le
 * ticket, même si SEUL `pending` est atteignable en passe 1 (aucune logique
 * de synchronisation n'existe encore pour faire progresser un item vers
 * `syncing`/`synced`/`conflict`). Modélisé dès maintenant pour que la passe
 * 2 n'ait pas à migrer le schéma IndexedDB — seulement à commencer à
 * produire ces valeurs.
 */
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict';

export type Decision = 'conforme' | 'reserve';

export interface ChecklistItemState {
  id: string;
  label: string;
  checked: boolean;
}

/**
 * Statut d'upload d'UNE photo — file INDÉPENDANTE de `SyncStatus` (celle du
 * brouillon entier) : ticket 010 passe 2, "une photo peut échouer à
 * uploader sans bloquer la synchronisation du reste de l'inspection". Pas
 * de `conflict` ici — aucune notion de conflit ne s'applique à un simple
 * upload de fichier (voir CLAUDE.md, addendum passe 2).
 */
export type MediaSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/** Une photo capturée localement — `blob` reste TEL QUE capturé (la
 * compression, ajoutée en passe 2, a lieu juste avant l'upload, jamais sur
 * la copie locale conservée pour relecture/aperçu). */
export interface LocalPhoto {
  id: string;
  blob: Blob;
  fileName: string;
  capturedAt: string;
  mediaSyncStatus: MediaSyncStatus;
  /** `Document.id` côté serveur une fois l'upload réussi — `null` tant que
   * `mediaSyncStatus !== 'synced'`. */
  remoteDocumentId: string | null;
  retryCount: number;
  /** Prochaine tentative autorisée (backoff exponentiel) — `null` tant
   * qu'aucun échec n'a encore eu lieu. */
  nextRetryAt: string | null;
}

/** Une mission = une inspection à mener, telle qu'affectée à l'inspecteur
 * courant. Ticket 012 : liste RÉELLE issue de `GET /api/control/missions/`
 * (`MOCK_MISSIONS`, ticket 010, a été retiré) — mise en cache localement
 * pour l'usage hors ligne (voir `db.ts`, object store `missions`). */
export interface Mission {
  id: string;
  lotName: string;
  assetName: string;
  programName: string;
  milestoneLabel: string;
  organizationId: string;
  workDeclarationId: string;
  /** Dérivé côté serveur (jamais stocké tel quel) : une Inspection
   * existe-t-elle déjà pour ce work_declaration, créée par cet inspecteur ?
   * Voir apps.inspections.services.list_missions_for_inspector. */
  completed: boolean;
}

/**
 * Le brouillon d'inspection tel que stocké en IndexedDB. `correlationId`
 * est généré côté client DÈS la création du brouillon (avant toute
 * synchronisation) — condition posée par le ticket pour que la passe 2
 * puisse tracer l'item de bout en bout côté serveur sans avoir à modifier
 * ce schéma.
 */
export interface InspectionDraft {
  /** Identique à `correlationId` — la clé primaire IndexedDB EST le
   * correlation ID, il n'existe pas d'identifiant local séparé qui
   * risquerait de diverger. */
  id: string;
  correlationId: string;
  missionId: string;
  checklist: ChecklistItemState[];
  comment: string;
  decision: Decision | null;
  photos: LocalPhoto[];
  /** Horloge de l'appareil AU MOMENT de la saisie — posée/mise à jour à
   * chaque sauvegarde locale, jamais dérivée du réseau. */
  deviceTimestamp: string;
  /** Horloge SERVEUR à réception — reste `null` tant que l'item n'a jamais
   * été synchronisé. Distinct de `deviceTimestamp` par construction : les
   * deux horloges peuvent diverger (dérive d'horloge, latence réseau), et
   * c'est précisément ce que ce champ doit pouvoir révéler une fois la
   * synchronisation construite (passe 2). */
  serverTimestamp: string | null;
  syncStatus: SyncStatus;

  /**
   * Dernier `TrustEvent.id` connu du client pour la cible de cette
   * inspection (WorkDeclaration/Evidence, ou Reserve pour un suivi) — `null`
   * pour tout brouillon saisi hors ligne sans jamais avoir observé l'état
   * réel du serveur (cas normal en passe 1/2, aucune récupération de l'état
   * courant n'est construite ici, voir CLAUDE.md addendum passe 2). C'est
   * cette valeur que le serveur compare à l'état RÉEL au moment de la
   * synchronisation : si elles diffèrent, `syncStatus` devient `conflict`
   * plutôt qu'un écrasement silencieux (voir `apps.inspections.services.
   * create_inspection`, paramètre `expected_latest_event_id`).
   */
  knownLatestEventId: string | null;
  /** Compteur de tentatives pour la file de DONNÉES (indépendant de celui
   * de chaque photo, voir `LocalPhoto.retryCount`) — remis à 0 dès un envoi
   * réussi. */
  retryCount: number;
  /** Prochaine tentative autorisée (backoff exponentiel) — `null` tant
   * qu'aucun échec n'a encore eu lieu ou après un succès. */
  nextRetryAt: string | null;
  /** Renseigné uniquement quand `syncStatus === 'conflict'` — ce que le
   * serveur a rapporté comme dernier événement réel, pour affichage à
   * l'inspecteur. Ne déclenche JAMAIS de nouvelle tentative automatique :
   * un conflit reste visible jusqu'à une action EXPLICITE (voir
   * `resolveConflictByDiscarding`/réécriture manuelle, ticket 010 passe 2). */
  conflict: { currentEventSource: string | null; currentEventCreatedAt: string | null } | null;
  /** `Evidence.id` côté serveur une fois toutes les photos synchronisées et
   * regroupées — `null` tant qu'aucune Evidence n'a encore été créée.
   * Indépendant de `syncStatus` : une Evidence peut exister AVANT, APRÈS,
   * ou en l'absence de toute Inspection synchronisée pour ce brouillon
   * (voir CLAUDE.md, addendum passe 2 : les deux files ne se bloquent
   * jamais mutuellement). */
  evidenceId: string | null;
}
