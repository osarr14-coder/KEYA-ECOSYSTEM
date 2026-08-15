import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/client';
import { CHECKLIST_TEMPLATE, MOCK_MISSIONS } from '../db/missions';
import { createEmptyDraft, getDraft, saveDraft } from '../db/repository';
import { runSyncCycle } from './syncEngine';

beforeEach(async () => {
  const databases = await indexedDB.databases();
  for (const database of databases) {
    if (database.name) indexedDB.deleteDatabase(database.name);
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function apiClient() {
  return createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => null });
}

describe('runSyncCycle — synchronisation réussie', () => {
  it(
    'un item pending passe à synced, avec correlation ID transmis et horodatage serveur reçu',
    async () => {
      const draft = createEmptyDraft(MOCK_MISSIONS[0].id, CHECKLIST_TEMPLATE);
      draft.decision = 'conforme';
      await saveDraft(draft);

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toContain('/control/sync/inspection/');
        const body = JSON.parse(init!.body as string);
        expect(body.correlation_id).toBe(draft.correlationId);
        expect(body.known_latest_event_id).toBeNull();
        expect(body.organization).toBe(MOCK_MISSIONS[0].organizationId);
        expect(body.work_declaration).toBe(MOCK_MISSIONS[0].workDeclarationId);
        return jsonResponse(201, {
          status: 'applied',
          inspection: {
            id: 'insp-1', created_at: '2026-08-15T10:00:00.000Z', client_correlation_id: draft.correlationId,
          },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await runSyncCycle(apiClient());

      const updated = await getDraft(draft.id);
      expect(updated?.syncStatus).toBe('synced');
      expect(updated?.serverTimestamp).toBe('2026-08-15T10:00:00.000Z');
      expect(updated?.retryCount).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    },
  );
});

describe(
  'runSyncCycle — conflit (ticket 010 passe 2, critère le plus important) : jamais un ' +
  'écrasement silencieux',
  () => {
    it('un conflit détecté (409) place l\'item en conflict, sans perdre la saisie locale, jamais retenté seul', async () => {
      const draft = createEmptyDraft(MOCK_MISSIONS[0].id, CHECKLIST_TEMPLATE);
      draft.comment = 'Fissure visible sur le mur nord.';
      draft.decision = 'reserve';
      await saveDraft(draft);

      const fetchMock = vi.fn(async () => jsonResponse(409, {
        status: 'conflict',
        current_event: {
          id: 'evt-1', level: 'controle', source: 'inspection_avec_reserve',
          created_at: '2026-08-15T09:00:00.000Z',
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      await runSyncCycle(apiClient());
      const afterFirstCycle = await getDraft(draft.id);
      expect(afterFirstCycle?.syncStatus).toBe('conflict');
      expect(afterFirstCycle?.conflict?.currentEventSource).toBe('inspection_avec_reserve');
      // La saisie de l'inspecteur reste EXACTEMENT ce qu'il a écrit — rien
      // n'est fusionné ni écrasé par la réponse du serveur.
      expect(afterFirstCycle?.comment).toBe('Fissure visible sur le mur nord.');
      expect(afterFirstCycle?.decision).toBe('reserve');

      // Un second passage du moteur ne retente RIEN automatiquement : un
      // conflit reste visible jusqu'à une action explicite (voir
      // InspectionFormView.tsx::resolveConflictByDiscarding), jamais une
      // nouvelle tentative silencieuse qui risquerait, elle, d'écraser
      // l'état serveur.
      await runSyncCycle(apiClient());
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  },
);

describe('runSyncCycle — retry avec backoff exponentiel, jamais un abandon silencieux', () => {
  it('un échec réseau reprogramme une tentative future, retentée seulement une fois le délai écoulé', async () => {
    vi.useFakeTimers();
    try {
      const draft = createEmptyDraft(MOCK_MISSIONS[0].id, CHECKLIST_TEMPLATE);
      draft.decision = 'conforme';
      await saveDraft(draft);

      const fetchMock = vi.fn(async () => {
        throw new Error('réseau indisponible');
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = apiClient();

      await runSyncCycle(client);
      const afterFailure = await getDraft(draft.id);
      // Jamais 'conflict' (ce n'est pas un conflit métier) ni disparu de la
      // file : reste 'pending', avec un compteur et une prochaine tentative.
      expect(afterFailure?.syncStatus).toBe('pending');
      expect(afterFailure?.retryCount).toBe(1);
      expect(afterFailure?.nextRetryAt).toBeTruthy();

      // Un cycle immédiat, avant l'échéance du backoff, ne retente rien.
      await runSyncCycle(client);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Une fois le délai de backoff écoulé, la tentative suivante a bien lieu.
      await vi.advanceTimersByTimeAsync(3000);
      await runSyncCycle(client);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('runSyncCycle — file média indépendante de la file de données', () => {
  it('un échec d\'upload de photo ne bloque jamais la synchronisation du reste de l\'inspection', async () => {
    const draft = createEmptyDraft(MOCK_MISSIONS[0].id, CHECKLIST_TEMPLATE);
    draft.decision = 'conforme';
    draft.photos = [{
      id: 'photo-1', blob: new Blob(['contenu-photo'], { type: 'image/jpeg' }), fileName: 'photo1.jpg',
      capturedAt: '2026-08-15T09:00:00.000Z', mediaSyncStatus: 'pending', remoteDocumentId: null,
      retryCount: 0, nextRetryAt: null,
    }];
    await saveDraft(draft);

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/control/sync/documents/')) {
        return jsonResponse(502, {});
      }
      if (String(url).includes('/control/sync/inspection/')) {
        return jsonResponse(201, {
          status: 'applied',
          inspection: {
            id: 'insp-2', created_at: '2026-08-15T10:00:00.000Z', client_correlation_id: draft.correlationId,
          },
        });
      }
      throw new Error(`URL non mockée dans ce test : ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await runSyncCycle(apiClient());

    const updated = await getDraft(draft.id);
    // La checklist/le commentaire/la décision se sont synchronisés malgré
    // l'échec de la photo.
    expect(updated?.syncStatus).toBe('synced');
    // La photo, elle, a échoué séparément — avec son propre compteur/délai,
    // jamais mélangé à celui de la file de données (qui vaut 0 ci-dessus).
    expect(updated?.photos[0].mediaSyncStatus).toBe('failed');
    expect(updated?.photos[0].retryCount).toBe(1);
    expect(updated?.photos[0].nextRetryAt).toBeTruthy();
    // Aucune Evidence : elle ne se crée qu'une fois TOUTES les photos
    // effectivement synchronisées.
    expect(updated?.evidenceId).toBeNull();

    vi.unstubAllGlobals();
  });

  it('une fois toutes les photos synchronisées, une Evidence est créée en les regroupant', async () => {
    const draft = createEmptyDraft(MOCK_MISSIONS[0].id, CHECKLIST_TEMPLATE);
    // Déjà synchronisée par un cycle précédent (hors scope de ce test) :
    // isole la file média pour ne pas déclencher, en plus, une tentative
    // sur la file de données (qui exigerait un troisième mock d'URL).
    draft.syncStatus = 'synced';
    draft.photos = [{
      id: 'photo-1', blob: new Blob(['contenu-photo'], { type: 'image/jpeg' }), fileName: 'photo1.jpg',
      capturedAt: '2026-08-15T09:00:00.000Z', mediaSyncStatus: 'pending', remoteDocumentId: null,
      retryCount: 0, nextRetryAt: null,
    }];
    await saveDraft(draft);

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/control/sync/documents/')) {
        return jsonResponse(201, { id: 'doc-1' });
      }
      if (String(url).includes('/control/sync/evidence/')) {
        return jsonResponse(201, { id: 'evidence-1' });
      }
      throw new Error(`URL non mockée dans ce test : ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await runSyncCycle(apiClient());

    const updated = await getDraft(draft.id);
    expect(updated?.photos[0].mediaSyncStatus).toBe('synced');
    expect(updated?.photos[0].remoteDocumentId).toBe('doc-1');
    expect(updated?.evidenceId).toBe('evidence-1');

    vi.unstubAllGlobals();
  });
});
