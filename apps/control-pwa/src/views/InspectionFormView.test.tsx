import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHECKLIST_TEMPLATE } from '../db/missions';
import * as repository from '../db/repository';
import { createEmptyDraft, getDraftForMission, patchDraft, saveDraft } from '../db/repository';
import { clearIndexedDB } from '../testUtils/clearIndexedDB';
import { InspectionFormView } from './InspectionFormView';

// Ticket 025 (audit — flake trouvé en relançant la suite complète après
// merge) : ce fichier avait sa PROPRE boucle de nettoyage locale, jamais
// mise à jour vers `clearIndexedDB()` (le correctif du ticket 012 pour
// exactement ce piège — `deleteDatabase()` renvoie une requête
// asynchrone, jamais une Promise ; ne pas attendre sa complétion réelle
// laissait une suppression en vol interférer avec le `saveDraft` du test
// suivant). `MissionsListView.test.tsx`/`App.test.tsx` utilisaient déjà
// le helper partagé — seul ce fichier avait divergé. Reproduit de façon
// non déterministe (~50 % d'échec) en relançant la suite COMPLÈTE
// plusieurs fois ; jamais en isolant ce seul fichier (confirme une
// interférence inter-fichiers, pas un bug du composant lui-même).
beforeEach(async () => {
  await clearIndexedDB();
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
  'InspectionFormView — échec d\'abandon d\'une saisie en conflit, jamais silencieux '
  + '(ticket F-034, même défaut que persist() — F-033 vague 4)',
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

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it(
      'un échec de deleteDraft affiche un bandeau explicite, jamais une rejection non gérée — '
      + 'la saisie en conflit reste affichée intacte',
      async () => {
        vi.spyOn(repository, 'deleteDraft').mockRejectedValue(new Error('QuotaExceededError'));
        await createConflictedDraft();

        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
        await screen.findByText('Conflit à résoudre', { selector: 'span' });
        fireEvent.click(screen.getByRole('button', { name: 'Ignorer ma saisie et recommencer' }));

        expect(await screen.findByText("Échec de l'abandon de la saisie.")).toBeInTheDocument();
        // La saisie en conflit reste intacte — rien n'a été perdu ni effacé.
        expect(screen.getByText('Conflit à résoudre', { selector: 'span' })).toBeInTheDocument();
        expect(screen.getByLabelText('Commentaire')).toHaveValue('Fissure visible');
        expect(screen.getByLabelText('Réserve')).toBeChecked();

        const draft = await getDraftForMission('mission-1');
        expect(draft).toBeDefined();
      },
    );

    it(
      'réessayer après un échec repart bien d\'un formulaire vierge, jamais bloqué sur '
      + 'le même échec indéfiniment',
      async () => {
        const realDeleteDraft = repository.deleteDraft;
        const deleteDraftSpy = vi.spyOn(repository, 'deleteDraft');
        deleteDraftSpy.mockRejectedValueOnce(new Error('QuotaExceededError'));
        await createConflictedDraft();

        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
        await screen.findByText('Conflit à résoudre', { selector: 'span' });
        fireEvent.click(screen.getByRole('button', { name: 'Ignorer ma saisie et recommencer' }));
        await screen.findByText("Échec de l'abandon de la saisie.");

        deleteDraftSpy.mockImplementation(realDeleteDraft);
        fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

        await waitFor(() => {
          expect(screen.getByLabelText('Commentaire')).toHaveValue('');
        });
        expect(screen.getByLabelText('Réserve')).not.toBeChecked();
        expect(screen.queryByText('Conflit à résoudre', { selector: 'span' })).not.toBeInTheDocument();
        expect(screen.queryByText("Échec de l'abandon de la saisie.")).not.toBeInTheDocument();

        const draft = await getDraftForMission('mission-1');
        expect(draft).toBeUndefined();
      },
    );
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

describe(
  'InspectionFormView — robustesse du chargement initial aux échecs IndexedDB (ticket F-033, vague 1)',
  () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it(
      'un échec de lecture au montage (même défaut que MissionsListView) affiche une erreur '
      + 'explicite, jamais un blocage indéfini sur "Chargement…"',
      async () => {
        vi.spyOn(repository, 'getDraftForMission').mockRejectedValueOnce(new Error('IndexedDB indisponible'));

        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger cette mission.');
        expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
        // Aucun formulaire n'est rendu par-dessus l'erreur (pas de checklist
        // fantôme sur un brouillon jamais réellement chargé).
        expect(screen.queryByText('Checklist')).not.toBeInTheDocument();
      },
    );

    it('un échec de lecture de la mission en cache (getCachedMission) est traité identiquement', async () => {
      vi.spyOn(repository, 'getCachedMission').mockRejectedValueOnce(new Error('IndexedDB indisponible'));

      render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

      expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger cette mission.');
    });

    it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement (ticket F-033, vague 3)', async () => {
      const getDraftForMissionSpy = vi.spyOn(repository, 'getDraftForMission')
        .mockRejectedValueOnce(new Error('IndexedDB indisponible'));

      render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

      await screen.findByRole('alert');
      getDraftForMissionSpy.mockRestore();
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

      await screen.findByText('Checklist');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  },
);

describe(
  'InspectionFormView — échec d\'enregistrement local, jamais silencieux (ticket F-033, vague 4)',
  () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it(
      'un échec d\'écriture affiche un bandeau explicite, la saisie optimiste reste '
      + 'visible à l\'écran malgré tout (jamais annulée)',
      async () => {
        vi.spyOn(repository, 'saveDraft').mockRejectedValue(new Error('QuotaExceededError'));

        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
        const checkbox = await screen.findByLabelText('Sécurité du chantier');
        fireEvent.click(checkbox);

        expect(await screen.findByText('Échec de l\'enregistrement local.')).toBeInTheDocument();
        expect(checkbox).toBeChecked();
      },
    );

    it(
      'réessayer après plusieurs échecs enregistre TOUT ce qui a été saisi entre-temps, '
      + 'jamais seulement la dernière modification (piège d\'un retry naïf qui rejouerait '
      + 'une seule mutation sur une base IndexedDB périmée)',
      async () => {
        const realSaveDraft = repository.saveDraft;
        vi.spyOn(repository, 'saveDraft').mockRejectedValue(new Error('QuotaExceededError'));

        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

        // Deux saisies DIFFÉRENTES pendant que l'enregistrement échoue —
        // aucune des deux n'atteint IndexedDB à ce stade.
        fireEvent.click(await screen.findByLabelText('Sécurité du chantier'));
        await screen.findByText('Échec de l\'enregistrement local.');

        const commentaire = screen.getByLabelText('Commentaire');
        fireEvent.change(commentaire, { target: { value: 'Fissure visible' } });
        fireEvent.blur(commentaire);

        expect(await getDraftForMission('mission-1')).toBeUndefined();

        // La panne se résout — le prochain "Réessayer" doit réussir.
        vi.spyOn(repository, 'saveDraft').mockImplementation(realSaveDraft);
        fireEvent.click(screen.getByRole('button', { name: "Réessayer l'enregistrement" }));

        await waitFor(() => expect(
          screen.queryByText('Échec de l\'enregistrement local.'),
        ).not.toBeInTheDocument());

        const saved = await getDraftForMission('mission-1');
        // Preuve directe contre un retry naïf : les DEUX saisies sont bien
        // présentes, pas seulement le commentaire (le plus récent).
        expect(saved?.checklist.find((item) => item.id === 'securite')?.checked).toBe(true);
        expect(saved?.comment).toBe('Fissure visible');
      },
    );

    it('un échec au retry laisse le bandeau affiché, réessayable à volonté', async () => {
      vi.spyOn(repository, 'saveDraft').mockRejectedValue(new Error('QuotaExceededError'));

      render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
      fireEvent.click(await screen.findByLabelText('Sécurité du chantier'));
      await screen.findByText('Échec de l\'enregistrement local.');

      fireEvent.click(screen.getByRole('button', { name: "Réessayer l'enregistrement" }));

      await waitFor(() => expect(screen.getByText('Échec de l\'enregistrement local.')).toBeInTheDocument());
    });

    it(
      'après un retry réussi, une nouvelle saisie est bien transmise à saveDraft '
      + '(la file n\'est pas restée bloquée)',
      async () => {
        // Ticket F-033 (vague 4) — piège de test rencontré en l'écrivant :
        // une première version vérifiait la persistance via une NOUVELLE
        // lecture IndexedDB (`getDraftForMission`, une connexion fraîche
        // supplémentaire). Ce fichier a déjà une « dette de fiabilité
        // résiduelle » documentée (ticket 026) sous suite complète — ce
        // 3e aller-retour supplémentaire (échec mocké, retry réel, cette
        // écriture) l'exposait au point de faire échouer le test même avec
        // un timeout de 8s, alors qu'il convergeait systématiquement en
        // moins de 200ms en isolation, sans jamais que le bandeau d'échec
        // ne réapparaisse pendant l'attente (tracé explicitement — donc
        // pas une vraie seconde panne). Corrigé en vérifiant directement
        // que `saveDraft` (l'espion, pas une relecture) est bien rappelé
        // après le retry — signal synchrone à l'appel, sans ouvrir de
        // connexion IndexedDB supplémentaire pour le vérifier.
        const realSaveDraft = repository.saveDraft;
        const saveDraftSpy = vi.spyOn(repository, 'saveDraft');
        saveDraftSpy.mockRejectedValueOnce(new Error('QuotaExceededError'));

        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
        fireEvent.click(await screen.findByLabelText('Sécurité du chantier'));
        await screen.findByText('Échec de l\'enregistrement local.');

        saveDraftSpy.mockImplementation(realSaveDraft);
        fireEvent.click(screen.getByRole('button', { name: "Réessayer l'enregistrement" }));
        await waitFor(() => expect(
          screen.queryByText('Échec de l\'enregistrement local.'),
        ).not.toBeInTheDocument());

        const callsAfterRetry = saveDraftSpy.mock.calls.length;
        fireEvent.click(await screen.findByLabelText('Conformité aux plans'));

        await waitFor(() => expect(saveDraftSpy.mock.calls.length).toBeGreaterThan(callsAfterRetry));
        expect(screen.queryByText('Échec de l\'enregistrement local.')).not.toBeInTheDocument();
      },
    );
  },
);

describe(
  'InspectionFormView — statut de synchronisation par photo, jamais silencieux (ticket F-033, vague 4)',
  () => {
    it('une photo tout juste ajoutée affiche "En attente d\'envoi"', async () => {
      render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

      const file = new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' });
      fireEvent.change(await screen.findByLabelText('Ajouter une photo'), { target: { files: [file] } });

      expect(await screen.findByText("En attente d'envoi")).toBeInTheDocument();
      // Attend l'écriture IndexedDB réelle avant la fin du test — sans quoi
      // elle peut se terminer APRÈS le `clearIndexedDB()` du test suivant et
      // le contaminer (même piège déjà documenté au ticket 025 pour ce
      // fichier).
      await waitFor(async () => {
        const stored = await getDraftForMission('mission-1');
        expect(stored?.photos).toHaveLength(1);
      });
    });

    it(
      'une photo restée en échec d\'upload (mediaSyncStatus="failed") l\'affiche '
      + 'explicitement au chargement du brouillon, jamais confondue avec une photo envoyée',
      async () => {
        const draft = createEmptyDraft('mission-1', CHECKLIST_TEMPLATE);
        await saveDraft({
          ...draft,
          photos: [{
            id: 'photo-1',
            blob: new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' }),
            fileName: 'photo.jpg',
            capturedAt: '2026-08-20T10:00:00.000Z',
            mediaSyncStatus: 'failed',
            remoteDocumentId: null,
            retryCount: 2,
            nextRetryAt: '2026-08-20T10:00:08.000Z',
          }],
        });

        render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

        expect(
          await screen.findByText("Échec d'envoi — nouvelle tentative automatique"),
        ).toBeInTheDocument();
        expect(screen.queryByText('Envoyée')).not.toBeInTheDocument();
      },
    );
  },
);
