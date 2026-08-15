import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyDraft, getAllDrafts, getDraft, getDraftForMission, saveDraft } from './repository';
import type { InspectionDraft } from './types';

const CHECKLIST_TEMPLATE = [
  { id: 'securite', label: 'Sécurité du chantier', checked: false },
  { id: 'conformite_plans', label: 'Conformité aux plans', checked: false },
];

function makePhotoBlob(content: string): Blob {
  return new Blob([content], { type: 'image/jpeg' });
}

beforeEach(async () => {
  // `fake-indexeddb` persiste dans un état global partagé entre tests —
  // repartir d'une base vide à chaque test, comme le ferait un appareil
  // fraîchement réinitialisé, pour ne pas qu'un test dépende de l'ordre
  // d'exécution des autres.
  const databases = await indexedDB.databases();
  for (const database of databases) {
    if (database.name) indexedDB.deleteDatabase(database.name);
  }
});

describe(
  'Persistance offline intégrale — critère d\'acceptation central de la passe 1 du ticket 010',
  () => {
    it(
      'une inspection complète (checklist, photos, commentaire, décision) saisie en mode ' +
      'avion survit à une fermeture totale de l\'application avant réouverture, sans perte',
      async () => {
        // "Mode avion complet" : on prouve qu'AUCUN appel réseau n'est
        // tenté à aucun moment de ce scénario — pas une supposition, une
        // assertion vérifiée à la fin du test.
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        // 1. Saisie complète, comme le ferait l'inspecteur dans l'UI.
        const draft = createEmptyDraft('mission-1', CHECKLIST_TEMPLATE);
        draft.checklist[0].checked = true;
        draft.checklist[1].checked = true;
        draft.comment = 'Fissure visible sur le mur nord, à surveiller.';
        draft.decision = 'reserve';
        draft.photos = [
          { id: 'photo-1', blob: makePhotoBlob('photo-1-content'), fileName: 'photo1.jpg', capturedAt: '2026-08-15T09:00:00.000Z' },
          { id: 'photo-2', blob: makePhotoBlob('photo-2-content'), fileName: 'photo2.jpg', capturedAt: '2026-08-15T09:01:00.000Z' },
        ];

        const saved = await saveDraft(draft);
        const deviceTimestampAtSave = saved.deviceTimestamp;

        // 2. "Fermeture totale de l'application" : chaque fonction du
        // repository ouvre puis FERME explicitement sa propre connexion
        // IndexedDB (voir db.ts — pas de singleton mis en cache). Relire
        // via un appel de fonction entièrement nouveau, dans un contexte
        // JS qui ne retient aucune référence à `draft`/`saved`, est donc
        // une preuve réelle de relecture depuis la base — pas une
        // coïncidence de portée mémoire du test.
        const reopened = await getDraft(saved.id);

        expect(reopened).toBeDefined();
        const restored = reopened as InspectionDraft;

        // 3. Rien n'a été perdu — chaque champ vérifié individuellement,
        // pas une comparaison d'objet globale qui masquerait quel champ a
        // réellement été perdu en cas d'échec.
        expect(restored.checklist).toEqual(draft.checklist);
        expect(restored.comment).toBe('Fissure visible sur le mur nord, à surveiller.');
        expect(restored.decision).toBe('reserve');
        expect(restored.photos).toHaveLength(2);
        expect(restored.photos[0].fileName).toBe('photo1.jpg');
        expect(restored.photos[1].fileName).toBe('photo2.jpg');

        // Les Blobs eux-mêmes ont survécu, pas seulement leurs métadonnées
        // — IndexedDB stocke des Blobs natifs, pas du base64 ; on relit le
        // contenu réel pour le prouver.
        const firstPhotoText = await restored.photos[0].blob.text();
        expect(firstPhotoText).toBe('photo-1-content');
        const secondPhotoText = await restored.photos[1].blob.text();
        expect(secondPhotoText).toBe('photo-2-content');

        // 4. Horodatage double : l'heure APPAREIL survit telle quelle,
        // l'heure SERVEUR reste vide (personne ne l'a jamais reçue —
        // aucune synchronisation n'existe cette passe).
        expect(restored.deviceTimestamp).toBe(deviceTimestampAtSave);
        expect(restored.serverTimestamp).toBeNull();

        // 5. Statut de synchronisation : reste "pending" indéfiniment,
        // explicitement attendu et documenté pour cette passe (aucune
        // logique n'existe pour le faire progresser).
        expect(restored.syncStatus).toBe('pending');

        // 6. Le correlation ID généré dès la saisie hors ligne a survécu
        // lui aussi — condition posée par le ticket pour la traçabilité
        // de bout en bout côté serveur, une fois la passe 2 construite.
        expect(restored.correlationId).toBe(draft.correlationId);

        // 7. "Mode avion complet" : preuve finale, aucun appel réseau n'a
        // eu lieu à AUCUN moment de ce scénario complet (saisie,
        // sauvegarde, fermeture, réouverture, relecture).
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    it('un brouillon jamais explicitement enregistré n\'existe pas en base (pas d\'écriture fantôme)', async () => {
      const draft = createEmptyDraft('mission-2', CHECKLIST_TEMPLATE);
      // Volontairement : aucun appel à saveDraft().

      const found = await getDraft(draft.id);

      expect(found).toBeUndefined();
    });

    it('reprendre une mission déjà entamée retrouve le MÊME brouillon (jamais un doublon)', async () => {
      const draft = createEmptyDraft('mission-1', CHECKLIST_TEMPLATE);
      draft.comment = 'Premier passage';
      await saveDraft(draft);

      const resumed = await getDraftForMission('mission-1');
      expect(resumed?.id).toBe(draft.id);
      expect(resumed?.comment).toBe('Premier passage');

      // Une seconde sauvegarde sur le MÊME brouillon (id inchangé) ne crée
      // jamais une seconde ligne pour la même mission.
      await saveDraft({ ...resumed!, comment: 'Complément après réinspection' });
      const allDrafts = await getAllDrafts();
      const draftsForMission1 = allDrafts.filter((item) => item.missionId === 'mission-1');
      expect(draftsForMission1).toHaveLength(1);
      expect(draftsForMission1[0].comment).toBe('Complément après réinspection');
    });

    it('chaque sauvegarde repose l\'horodatage appareil à l\'heure de CETTE sauvegarde', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-08-15T09:00:00.000Z'));
        const draft = createEmptyDraft('mission-1', CHECKLIST_TEMPLATE);
        const firstSave = await saveDraft(draft);
        expect(firstSave.deviceTimestamp).toBe('2026-08-15T09:00:00.000Z');

        vi.setSystemTime(new Date('2026-08-15T09:05:00.000Z'));
        const secondSave = await saveDraft({ ...firstSave, comment: 'Ajout après 5 minutes' });
        expect(secondSave.deviceTimestamp).toBe('2026-08-15T09:05:00.000Z');
      } finally {
        vi.useRealTimers();
      }
    });
  },
);
