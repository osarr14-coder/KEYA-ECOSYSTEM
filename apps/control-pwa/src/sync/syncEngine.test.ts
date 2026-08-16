import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/client';
import { CHECKLIST_TEMPLATE } from '../db/missions';
import { createEmptyDraft, getDraft, saveDraft } from '../db/repository';
import { clearIndexedDB } from '../testUtils/clearIndexedDB';
import { FIXTURE_MISSIONS, seedFixtureMissions } from '../testUtils/missionFixtures';
import { runSyncCycle } from './syncEngine';

beforeEach(async () => {
  await clearIndexedDB();
  // Ticket 012 : `syncDraft`/`findMission` lisent désormais le cache local
  // des missions (jamais `MOCK_MISSIONS`, retiré) — peuplé ici pour que la
  // résolution `organizationId`/`workDeclarationId` fonctionne dans ces tests.
  await seedFixtureMissions();
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
      const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
      draft.decision = 'conforme';
      await saveDraft(draft);

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toContain('/control/sync/inspection/');
        const body = JSON.parse(init!.body as string);
        expect(body.correlation_id).toBe(draft.correlationId);
        expect(body.known_latest_event_id).toBeNull();
        expect(body.organization).toBe(FIXTURE_MISSIONS[0].organizationId);
        expect(body.work_declaration).toBe(FIXTURE_MISSIONS[0].workDeclarationId);
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
      const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
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
      const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
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

describe(
  'runSyncCycle — bug 1 (ticket 013) : jamais de synchro sans décision explicite',
  () => {
    it(
      'un brouillon avec decision=null (checklist cochée, aucune décision choisie) ne déclenche '
      + 'jamais /control/sync/inspection/, reste pending indéfiniment',
      async () => {
        const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
        // Scénario exact du rapport : l'inspecteur a coché la checklist mais
        // n'a pas encore touché Conforme/Réserve.
        draft.checklist = draft.checklist.map((item) => ({ ...item, checked: true }));
        await saveDraft(draft);

        const fetchMock = vi.fn(async (url: string) => {
          throw new Error(`Aucun appel réseau attendu tant que decision est null, reçu : ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        await runSyncCycle(apiClient());
        const afterFirstCycle = await getDraft(draft.id);
        expect(afterFirstCycle?.syncStatus).toBe('pending');
        expect(fetchMock).not.toHaveBeenCalled();

        // Plusieurs passages du sondage périodique (ticket 010 passe 2) ne
        // changent rien tant que la décision n'est pas choisie.
        await runSyncCycle(apiClient());
        await runSyncCycle(apiClient());
        expect(fetchMock).not.toHaveBeenCalled();

        vi.unstubAllGlobals();
      },
    );

    it('dès que decision est choisie, le brouillon devient éligible à la synchro normale', async () => {
      const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
      draft.decision = 'reserve';
      await saveDraft(draft);

      let capturedBody: Record<string, unknown> | null = null;
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/control/sync/inspection/')) {
          capturedBody = JSON.parse(init!.body as string);
        }
        return jsonResponse(201, {
          status: 'applied',
          inspection: {
            id: 'insp-decision', created_at: '2026-08-16T10:00:00.000Z',
            client_correlation_id: draft.correlationId,
          },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await runSyncCycle(apiClient());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(capturedBody).not.toBeNull();
      expect(capturedBody!.outcome).toBe('avec_reserve');
      const updated = await getDraft(draft.id);
      expect(updated?.syncStatus).toBe('synced');

      vi.unstubAllGlobals();
    });
  },
);

describe(
  'runSyncCycle — bug 2 (ticket 013) : knownLatestEventId rafraîchi après une synchro réussie',
  () => {
    it(
      'après un premier succès, le draft retient le latest_event_id renvoyé par le serveur — une '
      + 'seconde synchro légitime (ex : édition du commentaire après coup) n\'est plus rejetée à tort',
      async () => {
        const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
        draft.decision = 'conforme';
        await saveDraft(draft);

        const fetchMock = vi.fn(async () => jsonResponse(201, {
          status: 'applied',
          inspection: {
            id: 'insp-refresh', created_at: '2026-08-16T10:00:00.000Z',
            client_correlation_id: draft.correlationId,
          },
          latest_event_id: 'evt-latest-après-succès',
        }));
        vi.stubGlobal('fetch', fetchMock);

        await runSyncCycle(apiClient());
        const afterSuccess = await getDraft(draft.id);
        expect(afterSuccess?.syncStatus).toBe('synced');
        // Avant correction : reste `null` (jamais mis à jour) — c'est
        // exactement ce qui provoque le conflit permanent du rapport.
        expect(afterSuccess?.knownLatestEventId).toBe('evt-latest-après-succès');

        vi.unstubAllGlobals();
      },
    );
  },
);

describe(
  'runSyncCycle — bug 3 (ticket 013) : reserveId transmis pour une mission de suivi',
  () => {
    it(
      'quand la mission en cache porte un reserveId (mission de suivi), il est transmis à '
      + 'syncInspection — sans quoi l\'inspecteur ne peut jamais lever la réserve',
      async () => {
        const missionWithReserve = { ...FIXTURE_MISSIONS[0], reserveId: 'reserve-abc-123' };
        await seedFixtureMissions([missionWithReserve, ...FIXTURE_MISSIONS.slice(1)]);

        const draft = createEmptyDraft(missionWithReserve.id, CHECKLIST_TEMPLATE);
        draft.decision = 'conforme';
        await saveDraft(draft);

        // La requête capturée est vérifiée APRÈS `runSyncCycle`, jamais dans
        // le mock lui-même : une assertion qui échoue à l'intérieur d'un
        // `vi.fn` async est interceptée par le `catch` réseau de `syncDraft`
        // (traitée comme un échec réseau ordinaire, avec retry/backoff) —
        // elle ne remonte JAMAIS comme un échec de test. Piège rencontré en
        // écrivant ce test : la première version passait à tort.
        let capturedBody: Record<string, unknown> | null = null;
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
          if (String(url).includes('/control/sync/inspection/')) {
            capturedBody = JSON.parse(init!.body as string);
          }
          return jsonResponse(201, {
            status: 'applied',
            inspection: {
              id: 'insp-reserve', created_at: '2026-08-16T10:00:00.000Z',
              client_correlation_id: draft.correlationId,
            },
            latest_event_id: 'evt-latest-reserve',
          });
        });
        vi.stubGlobal('fetch', fetchMock);

        await runSyncCycle(apiClient());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(capturedBody).not.toBeNull();
        expect(capturedBody!.reserve).toBe('reserve-abc-123');

        vi.unstubAllGlobals();
      },
    );

    it(
      'un brouillon neuf sur une mission de suivi (jamais synchronisé) amorce knownLatestEventId '
      + 'depuis mission.reserveLatestEventId — la réserve peut donc être levée dès le premier essai',
      async () => {
        const missionWithReserve = {
          ...FIXTURE_MISSIONS[0], reserveId: 'reserve-xyz-789', reserveLatestEventId: 'evt-ouverte-xyz',
        };
        await seedFixtureMissions([missionWithReserve, ...FIXTURE_MISSIONS.slice(1)]);

        // `createEmptyDraft` avec le 3e argument omis serait le bug : elle
        // partirait de `null`, contre un historique réel côté serveur.
        const draft = createEmptyDraft(
          missionWithReserve.id, CHECKLIST_TEMPLATE, missionWithReserve.reserveLatestEventId,
        );
        draft.decision = 'conforme';
        await saveDraft(draft);

        let capturedBody: Record<string, unknown> | null = null;
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
          if (String(url).includes('/control/sync/inspection/')) {
            capturedBody = JSON.parse(init!.body as string);
          }
          return jsonResponse(201, {
            status: 'applied',
            inspection: {
              id: 'insp-followup-first-try', created_at: '2026-08-16T10:00:00.000Z',
              client_correlation_id: draft.correlationId,
            },
            latest_event_id: 'evt-levee-xyz',
          });
        });
        vi.stubGlobal('fetch', fetchMock);

        await runSyncCycle(apiClient());
        expect(capturedBody).not.toBeNull();
        expect(capturedBody!.known_latest_event_id).toBe('evt-ouverte-xyz');
        expect(capturedBody!.reserve).toBe('reserve-xyz-789');

        const updated = await getDraft(draft.id);
        expect(updated?.syncStatus).toBe('synced');

        vi.unstubAllGlobals();
      },
    );

    it('quand la mission n\'a aucune réserve ouverte, le champ reserve reste explicitement null', async () => {
      const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
      draft.decision = 'conforme';
      await saveDraft(draft);

      let capturedBody: Record<string, unknown> | null = null;
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/control/sync/inspection/')) {
          capturedBody = JSON.parse(init!.body as string);
        }
        return jsonResponse(201, {
          status: 'applied',
          inspection: {
            id: 'insp-no-reserve', created_at: '2026-08-16T10:00:00.000Z',
            client_correlation_id: draft.correlationId,
          },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await runSyncCycle(apiClient());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(capturedBody).not.toBeNull();
      expect(capturedBody!.reserve).toBeNull();

      vi.unstubAllGlobals();
    });
  },
);

describe('runSyncCycle — file média indépendante de la file de données', () => {
  it('un échec d\'upload de photo ne bloque jamais la synchronisation du reste de l\'inspection', async () => {
    const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
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
    const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, CHECKLIST_TEMPLATE);
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
