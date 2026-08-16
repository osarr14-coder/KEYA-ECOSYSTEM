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
    };
    return { status: 'applied', inspection: data.inspection };
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
    }));
  }

  return { syncDocument, syncEvidence, syncInspection, listMissions };
}

export type ApiClient = ReturnType<typeof createApiClient>;
