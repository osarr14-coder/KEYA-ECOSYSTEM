import type { TrustLevelEvidence, TrustLevelKey } from '@keya/design-system';
import type { Mission } from '../db/types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken: () => string | null;
}

export interface SyncInspectionResult {
  status: 'applied' | 'conflict';
  inspection?: { id: string; created_at: string; client_correlation_id: string | null };
  currentEvent?: { id: string | null; level: string | null; source: string | null; createdAt: string | null } | null;
  /** Ticket 013 (bug 2) : présent uniquement quand `status === 'applied'` —
   * à reporter dans `InspectionDraft.knownLatestEventId` pour que toute
   * synchro suivante légitime sur cette même cible ne soit plus rejetée. */
  latestEventId?: string;
}

/** Audit UI R1 (K01) — pièces soumises par le constructeur, par version. */
export interface SubmittedDocument {
  id: string;
  fileName: string;
  sha256: string;
}

export interface SubmittedEvidence {
  id: string;
  version: number;
  addedBy: string;
  addedAt: string;
  documents: SubmittedDocument[];
}

/** Audit UI R1 (K02/K03) — réserve structurée, ouverte ou en attente de décision. */
export interface OpenReserve {
  id: string;
  motif: string;
  expectedAction: string;
  openedAt: string;
  statusLabel: string;
  corrections: { submittedAt: string; submittedBy: string }[];
}

export interface MissionDetail {
  id: string;
  lotName: string;
  assetName: string;
  programName: string;
  milestoneLabel: string;
  followUp: boolean;
  completed: boolean;
  declaration: { id: string; declaredBy: string; declaredAt: string; note: string };
  evidences: SubmittedEvidence[];
  openReserves: OpenReserve[];
  /** PO-2026-09-28-04 : niveaux de confiance atteints du jalon contrôlé. */
  trustLevels?: Partial<Record<TrustLevelKey, TrustLevelEvidence>>;
}

export interface OpinionPayload {
  outcome: 'conforme' | 'avec_reserve';
  examinedEvidenceIds: string[];
  reserves: { motif: string; expectedAction: string }[];
  decisions: { reserveId: string; decision: 'levee' | 'maintenue'; motif: string }[];
  note: string;
}

export interface OpinionResult {
  inspectionId: string;
  /** Date SERVEUR de l'avis (K04 : la date serveur fait foi). */
  recordedAt: string;
}

/**
 * Client HTTP dédié à la synchronisation CONTROL (ticket 010, passe 2) —
 * même schéma que `apps/build/src/api/client.ts` (`ApiError`, un `getAccessToken`
 * injecté, jamais de logique métier ici). `syncInspection` est la seule
 * méthode qui NE lève PAS d'exception sur un statut HTTP non-2xx attendu
 * (409) : un conflit est un résultat métier normal de cette route, pas une
 * erreur de transport — voir `apps.control.views.SyncInspectionView`.
 */
export function createApiClient({ baseUrl, getAccessToken }: ApiClientConfig) {
  function authHeaders(): Record<string, string> {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function syncDocument(params: {
    organizationId: string; file: Blob; fileName: string; category: string; source: string;
    correlationId: string;
  }): Promise<string> {
    const formData = new FormData();
    formData.append('organization', params.organizationId);
    // Enveloppé en `File` plutôt que passé tel quel : couvre aussi bien un
    // vrai `File` (capture caméra en production) qu'un `Blob` compressé
    // (voir `media/compressImage.ts`) — et contourne au passage un piège
    // d'environnement de test connu (voir `setupTests.ts` : `globalThis.Blob`
    // y est réassigné au Blob natif de Node pour un tout autre bug,
    // ticket 010 passe 1, ce qui casse le contrôle de type strict de
    // `FormData.append` sur un Blob passé nu dans jsdom — un `File`
    // construit via l'implémentation jsdom, elle, n'est jamais concernée).
    formData.append('file', new File([params.file], params.fileName, { type: params.file.type }));
    formData.append('category', params.category);
    formData.append('source', params.source);
    formData.append('correlation_id', params.correlationId);

    const response = await fetch(`${baseUrl}/api/control/sync/documents/`, {
      method: 'POST', headers: authHeaders(), body: formData,
    });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de synchronisation du document (${response.status})`);
    }
    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async function syncEvidence(params: {
    organizationId: string; workDeclarationId: string; documentIds: string[]; correlationId: string;
  }): Promise<string> {
    const response = await fetch(`${baseUrl}/api/control/sync/evidence/`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization: params.organizationId,
        work_declaration: params.workDeclarationId,
        documents: params.documentIds,
        correlation_id: params.correlationId,
      }),
    });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de synchronisation de l'evidence (${response.status})`);
    }
    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async function syncInspection(params: {
    organizationId: string; workDeclarationId: string; outcome: 'conforme' | 'avec_reserve'; note: string;
    reserveId?: string | null; correlationId: string; knownLatestEventId: string | null;
  }): Promise<SyncInspectionResult> {
    const response = await fetch(`${baseUrl}/api/control/sync/inspection/`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization: params.organizationId,
        work_declaration: params.workDeclarationId,
        outcome: params.outcome,
        note: params.note,
        reserve: params.reserveId ?? null,
        correlation_id: params.correlationId,
        known_latest_event_id: params.knownLatestEventId,
      }),
    });

    if (response.status === 409) {
      const data = (await response.json()) as {
        status: 'conflict';
        current_event: { id: string; level: string; source: string; created_at: string } | null;
      };
      return {
        status: 'conflict',
        currentEvent: data.current_event
          ? {
              id: data.current_event.id, level: data.current_event.level,
              source: data.current_event.source, createdAt: data.current_event.created_at,
            }
          : null,
      };
    }
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de synchronisation de l'inspection (${response.status})`);
    }
    const data = (await response.json()) as {
      status: 'applied';
      inspection: { id: string; created_at: string; client_correlation_id: string | null };
      latest_event_id: string;
    };
    return { status: 'applied', inspection: data.inspection, latestEventId: data.latest_event_id };
  }

  /**
   * `GET /api/control/missions/` — ticket 012, remplace `MOCK_MISSIONS`
   * (ticket 010). Le backend renvoie déjà des clés `snake_case`
   * (`apps.inspections.services.list_missions_for_inspector`) : conversion
   * ICI vers le `camelCase` attendu par `Mission`, jamais côté composant.
   */
  async function listMissions(): Promise<Mission[]> {
    const response = await fetch(`${baseUrl}/api/control/missions/`, {
      method: 'GET', headers: authHeaders(),
    });
    if (!response.ok) {
      throw new ApiError(response.status, `Échec de récupération des missions (${response.status})`);
    }
    const data = (await response.json()) as Array<{
      id: string; lot_name: string; asset_name: string; program_name: string; milestone_label: string;
      organization_id: string; work_declaration_id: string; completed: boolean;
      reserve_id: string | null; reserve_latest_event_id: string | null; follow_up?: boolean;
      assigned_at?: string;
      outcome?: {
        outcome: 'conforme' | 'avec_reserve'; outcome_label: string; recorded_at: string;
        reserves_opened: number; reserves_lifted: number; reserves_maintained: number;
      } | null;
    }>;
    return data.map((row) => ({
      id: row.id,
      lotName: row.lot_name,
      assetName: row.asset_name,
      programName: row.program_name,
      milestoneLabel: row.milestone_label,
      organizationId: row.organization_id,
      workDeclarationId: row.work_declaration_id,
      completed: row.completed,
      reserveId: row.reserve_id,
      reserveLatestEventId: row.reserve_latest_event_id,
      followUp: row.follow_up ?? false,
      assignedAt: row.assigned_at,
      outcome: row.outcome ? {
        outcome: row.outcome.outcome,
        outcomeLabel: row.outcome.outcome_label,
        recordedAt: row.outcome.recorded_at,
        reservesOpened: row.outcome.reserves_opened,
        reservesLifted: row.outcome.reserves_lifted,
        reservesMaintained: row.outcome.reserves_maintained,
      } : null,
    }));
  }

  function errorDetail(body: unknown, fallback: string) {
    if (body && typeof body === 'object' && 'detail' in body) return String((body as { detail: unknown }).detail);
    return fallback;
  }

  /** `GET /api/control/missions/{id}/` — audit UI R1 (K01) : déclaration,
   * pièces soumises (versions, déposant, date) et réserves ouvertes. */
  async function getMissionDetail(missionId: string): Promise<MissionDetail> {
    const response = await fetch(`${baseUrl}/api/control/missions/${missionId}/`, { method: 'GET', headers: authHeaders() });
    if (!response.ok) throw new ApiError(response.status, `Mission introuvable (${response.status})`);
    const data = await response.json();
    return {
      id: data.id,
      lotName: data.lot_name,
      assetName: data.asset_name,
      programName: data.program_name,
      milestoneLabel: data.milestone_label,
      followUp: data.follow_up,
      completed: data.completed,
      declaration: {
        id: data.declaration.id,
        declaredBy: data.declaration.declared_by,
        declaredAt: data.declaration.declared_at,
        note: data.declaration.note,
      },
      evidences: (data.evidences as Array<Record<string, unknown>>).map((evidence) => ({
        id: String(evidence.id),
        version: Number(evidence.version),
        addedBy: String(evidence.added_by),
        addedAt: String(evidence.added_at),
        documents: (evidence.documents as Array<Record<string, string>>).map((document) => ({
          id: document.id, fileName: document.file_name, sha256: document.sha256,
        })),
      })),
      openReserves: (data.open_reserves as Array<Record<string, unknown>>).map((reserve) => ({
        id: String(reserve.id),
        motif: String(reserve.motif),
        expectedAction: String(reserve.expected_action),
        openedAt: String(reserve.opened_at),
        statusLabel: String(reserve.status_label),
        corrections: (reserve.corrections as Array<Record<string, string>>).map((correction) => ({
          submittedAt: correction.submitted_at, submittedBy: correction.submitted_by,
        })),
      })),
      trustLevels: (data.trust_levels ?? {}) as Partial<Record<TrustLevelKey, TrustLevelEvidence>>,
    };
  }

  /** `POST /api/control/missions/{id}/avis/` — audit UI R1 (K01–K04) : avis
   * EN LIGNE, versions examinées, réserves structurées et décision
   * explicite par réserve. Les refus du serveur (règles du CDC §7.1)
   * remontent tels quels. */
  async function submitOpinion(missionId: string, payload: OpinionPayload): Promise<OpinionResult> {
    const response = await fetch(`${baseUrl}/api/control/missions/${missionId}/avis/`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outcome: payload.outcome,
        examined_evidence_ids: payload.examinedEvidenceIds,
        reserves: payload.reserves.map((reserve) => ({ motif: reserve.motif, expected_action: reserve.expectedAction })),
        decisions: payload.decisions.map((decision) => ({
          reserve_id: decision.reserveId, decision: decision.decision, motif: decision.motif,
        })),
        note: payload.note,
      }),
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    if (!response.ok) throw new ApiError(response.status, errorDetail(body, `L’avis n’a pas été enregistré (${response.status}).`));
    const data = body as { inspection_id: string; recorded_at: string };
    return { inspectionId: data.inspection_id, recordedAt: data.recorded_at };
  }

  /** Pièce du constructeur, lue avec la session (aucun lien public, CDC §10). */
  async function fetchDocument(missionId: string, documentId: string): Promise<Blob> {
    const response = await fetch(`${baseUrl}/api/control/missions/${missionId}/documents/${documentId}/`, {
      method: 'GET', headers: authHeaders(),
    });
    if (!response.ok) throw new ApiError(response.status, `Pièce indisponible (${response.status})`);
    return response.blob();
  }

  return {
    syncDocument, syncEvidence, syncInspection, listMissions, getMissionDetail, submitOpinion, fetchDocument,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
