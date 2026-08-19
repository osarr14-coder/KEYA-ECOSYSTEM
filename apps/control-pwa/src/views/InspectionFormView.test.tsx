import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHECKLIST_TEMPLATE } from '../db/missions';
import * as repository from '../db/repository';
import { createEmptyDraft, getDraftForMission, patchDraft, saveDraft } from '../db/repository';
import { InspectionFormView } from './InspectionFormView';

beforeEach(async () => {
  const databases = await indexedDB.databases();
  for (const database of databases) {
    if (database.name) indexedDB.deleteDatabase(database.name);
  }
});

describe('InspectionFormView — chaque saisie est écrite immédiatement, jamais différée', () => {
  it('cocher un item de la checklist le persiste aussitôt en IndexedDB', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    const checkbox = await screen.findByLabelText('Sécurité du chantier');
    fireEvent.click(checkbox);

    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.checklist.find((item) => item.id === 'securite')?.checked).toBe(true);
    });
  });

  it('le commentaire est persisté à la perte de focus (blur), pas à chaque frappe', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    const textarea = await screen.findByLabelText('Commentaire');
    fireEvent.change(textarea, { target: { value: 'Fissure visible' } });
    fireEvent.blur(textarea);

    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.comment).toBe('Fissure visible');
    });
  });

  it('choisir une décision la persiste aussitôt', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    fireEvent.click(await screen.findByLabelText('Réserve'));

    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.decision).toBe('reserve');
    });
  });

  it('ajouter une photo la persiste aussitôt, avec son contenu binaire', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    const file = new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' });
    const input = await screen.findByLabelText('Ajouter une photo');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.photos).toHaveLength(1);
      expect(draft?.photos[0].fileName).toBe('photo.jpg');
    });
    expect(await screen.findByText('photo.jpg')).toBeInTheDocument();
  });

  it('supprimer une photo la retire d\'IndexedDB', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    const file = new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(await screen.findByLabelText('Ajouter une photo'), { target: { files: [file] } });
    await screen.findByText('photo.jpg');

    fireEvent.click(screen.getByLabelText('Supprimer photo.jpg'));

    expect(screen.queryByText('photo.jpg')).not.toBeInTheDocument();
    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.photos).toHaveLength(0);
    });
  });

  it('rouvrir une mission déjà entamée recharge son brouillon existant, pas un formulaire vierge', async () => {
    const { unmount } = render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Sécurité du chantier'));
    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.checklist.find((item) => item.id === 'securite')?.checked).toBe(true);
    });
    unmount();

    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
    const checkbox = await screen.findByLabelText('Sécurité du chantier') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('le bouton retour appelle onBack', async () => {
    const onBack = vi.fn();
    render(<InspectionFormView missionId="mission-1" onBack={onBack} />);

    fireEvent.click(await screen.findByRole('button', { name: '← Missions' }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe(
  'InspectionFormView — cibles tactiles (ticket 024, audit accessibilité : app '
  + 'explicitement tactile 360-430px, WCAG 2.5.5)',
  () => {
    it('le bouton "← Missions" garde une hauteur minimale de 44px malgré un padding réduit', async () => {
      render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

      const backButton = await screen.findByRole('button', { name: '← Missions' });

      expect(backButton).toHaveStyle({ minHeight: '44px' });
    });

    it('le bouton "Supprimer" d\'une photo mesure au moins 44x44', async () => {
      render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

      const file = new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' });
      fireEvent.change(await screen.findByLabelText('Ajouter une photo'), { target: { files: [file] } });

      const removeButton = await screen.findByLabelText('Supprimer photo.jpg');
      expect(removeButton).toHaveStyle({ minHeight: '44px', minWidth: '44px' });
    });
  },
);

describe(
  'InspectionFormView — un conflit (ticket 010 passe 2) reste visible jusqu\'à une action ' +
  'explicite, jamais résolu automatiquement',
  () => {
    async function createConflictedDraft() {
      const draft = createEmptyDraft('mission-1', CHECKLIST_TEMPLATE);
      draft.comment = 'Fissure visible';
      draft.decision = 'reserve';
      draft.syncStatus = 'conflict';
      draft.conflict = { currentEventSource: 'inspection_avec_reserve', currentEventCreatedAt: '2026-08-15T09:00:00.000Z' };
      await saveDraft(draft);
      return draft;
    }

    it('affiche le conflit et la saisie locale intacte, jamais un état vierge silencieux', async () => {
      await createConflictedDraft();
      render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

      expect(await screen.findByText('Conflit à résoudre', { selector: 'span' })).toBeInTheDocument();
      expect(screen.getByText(/inspection_avec_reserve/)).toBeInTheDocument();
      expect(screen.getByLabelText('Commentaire')).toHaveValue('Fissure visible');
      expect(screen.getByLabelText('Réserve')).toBeChecked();
    });

    it('l\'action explicite "Ignorer ma saisie et recommencer" repart d\'un formulaire vierge', async () => {
      await createConflictedDraft();
      render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
      await screen.findByText('Conflit à résoudre', { selector: 'span' });

      fireEvent.click(screen.getByRole('button', { name: 'Ignorer ma saisie et recommencer' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Commentaire')).toHaveValue('');
      });
      expect(screen.getByLabelText('Réserve')).not.toBeChecked();
      expect(screen.queryByText('Conflit à résoudre', { selector: 'span' })).not.toBeInTheDocument();

      // Le brouillon en conflit a bien été supprimé d'IndexedDB — un
      // rechargement de la mission ne le retrouve plus.
      const draft = await getDraftForMission('mission-1');
      expect(draft).toBeUndefined();
    });
  },
);

describe(
  'InspectionFormView — persist() concurrents (ticket 015) : deux saisies presque simultanées '
  + 'ne doivent jamais s\'écraser mutuellement',
  () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it(
      'ajouter une photo puis choisir une décision sans attendre la première persistance '
      + 'conservent bien les DEUX changements, même si l\'écriture IndexedDB la plus ancienne '
      + 'se termine APRÈS la plus récente',
      async () => {
        // `saveDraft` réel (`db.put`, remplacement intégral de l'objet) est
        // capturé AVANT le mock — chaque appel intercepté est mis en attente
        // ici, résolu manuellement plus bas, plutôt que d'écrire tout de
        // suite : c'est ce qui permet de forcer déterministe­ment le pire
        // ordre de résolution (le plus ancien appel qui se termine en
        // dernier), sans dépendre d'un quelconque délai/sleep.
        const realSaveDraft = repository.saveDraft;
        const pending: Array<() => void> = [];
        let totalCalls = 0;
        vi.spyOn(repository, 'saveDraft').mockImplementation((draft) => (
          new Promise((resolve) => {
            totalCalls += 1;
            pending.push(() => { void realSaveDraft(draft).then(resolve); });
          })
        ));

        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

        const file = new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' });
        // Les deux interactions sont déclenchées SANS rien attendre entre
        // les deux — reproduit le scénario réel (upload photo pendant que
        // l'inspecteur choisit déjà sa décision) sans sleep : c'est le
        // véritable chevauchement des deux `persist()`, pas une simulation.
        fireEvent.change(await screen.findByLabelText('Ajouter une photo'), { target: { files: [file] } });
        fireEvent.click(screen.getByLabelText('Réserve'));

        // Draine les écritures interceptées, en ordre INVERSE de leur
        // arrivée, jusqu'à ce que les deux mutations logiques (photo +
        // décision) aient bien été émises — reproduit le pire ordre de
        // résolution possible pour une implémentation qui ne sérialise pas
        // ses écritures, sans présumer combien seront concurrentes à un
        // instant donné (une implémentation corrigée peut très bien les
        // sérialiser une par une).
        while (totalCalls < 2 || pending.length > 0) {
          if (pending.length === 0) {
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => expect(pending.length).toBeGreaterThan(0));
          }
          const toResolve = pending.splice(0).reverse();
          toResolve.forEach((resolve) => resolve());
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }

        await waitFor(async () => {
          const draft = await getDraftForMission('mission-1');
          expect(draft?.photos).toHaveLength(1);
          expect(draft?.decision).toBe('reserve');
        });
      },
    );
  },
);

describe(
  'InspectionFormView — une saisie après une synchro en arrière-plan (5e parcours) ne doit '
  + 'jamais écraser les champs pilotés par le moteur de synchro',
  () => {
    it(
      'ajouter une photo après que le moteur a marqué le brouillon "synced" en arrière-plan '
      + 'conserve syncStatus et knownLatestEventId à jour, sans revenir à leur état avant synchro',
      async () => {
        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

        // Première saisie réelle : crée le brouillon en IndexedDB (aucune
        // écriture avant ça, voir `createEmptyDraft`).
        fireEvent.click(await screen.findByLabelText('Réserve'));
        const created = await waitFor(async () => {
          const draft = await getDraftForMission('mission-1');
          expect(draft).toBeDefined();
          return draft!;
        });

        // Simule une synchro complète menée en arrière-plan par le moteur
        // PENDANT que ce formulaire reste ouvert — `patchDraft` est la
        // fonction que `syncEngine.ts` utilise réellement pour ces
        // écritures, jamais `saveDraft` (réservée aux saisies humaines,
        // voir son docstring) : le composant ne relit jamais ce résultat
        // tout seul, contrairement à `syncEngine.ts` (ticket 015 ter).
        await patchDraft({
          ...created,
          syncStatus: 'synced',
          knownLatestEventId: 'server-event-after-first-sync',
          serverTimestamp: '2026-08-18T22:45:25.000Z',
        });

        // Une saisie supplémentaire, plus tard, dans le MÊME formulaire
        // resté ouvert (le composant n'a jamais relu l'écriture ci-dessus) :
        // reproduit exactement le scénario du 5e parcours bout-en-bout
        // (photo ajoutée après que l'inspection a déjà été synchronisée).
        const file = new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' });
        fireEvent.change(await screen.findByLabelText('Ajouter une photo'), { target: { files: [file] } });

        await waitFor(async () => {
          const draft = await getDraftForMission('mission-1');
          expect(draft?.photos).toHaveLength(1);
        });

        const finalDraft = await getDraftForMission('mission-1');
        // La photo a bien été ajoutée...
        expect(finalDraft?.photos).toHaveLength(1);
        // ...mais `syncStatus`/`knownLatestEventId`, écrits par le moteur
        // de synchro pendant que ce formulaire était ouvert, ne doivent
        // JAMAIS être écrasés vers leur état périmé d'avant synchro — sous
        // peine de déclencher une resoumission inutile de l'inspection avec
        // un `knownLatestEventId` obsolète, rejetée à tort en conflit (409)
        // par le serveur alors qu'aucun conflit réel n'existe.
        expect(finalDraft?.syncStatus).toBe('synced');
        expect(finalDraft?.knownLatestEventId).toBe('server-event-after-first-sync');
      },
    );
  },
);
