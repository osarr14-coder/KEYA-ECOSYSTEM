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

/** Une photo capturée localement — le Blob brut, TEL QUE capturé. Aucune
 * compression ici (explicitement hors scope de cette passe, voir ticket :
 * "File média : compression côté client..." est un point de la passe 2). */
export interface LocalPhoto {
  id: string;
  blob: Blob;
  fileName: string;
  capturedAt: string;
}

/** Une mission = une inspection à mener, telle que proposée à l'inspecteur.
 * Mock statique en passe 1 (voir `missions.ts`) — aucun fetch réseau,
 * remplacé par une vraie synchronisation en passe 2. */
export interface Mission {
  id: string;
  lotName: string;
  assetName: string;
  programName: string;
  milestoneLabel: string;
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
}
