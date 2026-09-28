import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import * as repository from '../db/repository';
import { createEmptyDraft, saveDraft } from '../db/repository';
import { clearIndexedDB } from '../testUtils/clearIndexedDB';
import { FIXTURE_MISSIONS, seedFixtureMissions } from '../testUtils/missionFixtures';
import { MISSIONS_UPDATED_EVENT } from '../sync/syncEngine';
import { MissionsListView, outcomeSummary } from './MissionsListView';

beforeEach(async () => {
  await clearIndexedDB();
  // Ticket 012 : la liste vient désormais du cache local (`getCachedMissions`),
  // jamais de `MOCK_MISSIONS` (retiré) — peuplé ici pour chaque test.
  await seedFixtureMissions();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MissionsListView', () => {
  it('affiche toutes les missions', async () => {
    render(<MissionsListView onSelectMission={() => {}} />);
    for (const mission of FIXTURE_MISSIONS) {
      expect(await screen.findByText(mission.lotName)).toBeInTheDocument();
    }
  });

  it('sélectionner une mission déclenche onSelectMission avec son id', async () => {
    const onSelectMission = vi.fn();
    render(<MissionsListView onSelectMission={onSelectMission} />);

    fireEvent.click(await screen.findByText(FIXTURE_MISSIONS[0].lotName));

    expect(onSelectMission).toHaveBeenCalledWith(FIXTURE_MISSIONS[0].id);
  });

  it('affiche le statut de synchronisation d\'une mission déjà entamée', async () => {
    const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, [{ id: 'x', label: 'X', checked: false }]);
    await saveDraft(draft);

    render(<MissionsListView onSelectMission={() => {}} />);

    expect(await screen.findByText('En attente de synchronisation')).toBeInTheDocument();
  });

  it('n\'affiche aucun statut pour une mission jamais entamée', async () => {
    render(<MissionsListView onSelectMission={() => {}} />);

    await screen.findByText(FIXTURE_MISSIONS[0].lotName);
    expect(screen.queryByText('En attente de synchronisation')).not.toBeInTheDocument();
  });

  it('affiche un état vide explicite quand aucune mission n\'est en cache', async () => {
    await clearIndexedDB();
    render(<MissionsListView onSelectMission={() => {}} />);
    expect(await screen.findByText('Aucune mission pour le moment.')).toBeInTheDocument();
  });

  it(
    'distingue visuellement une mission de suivi (réserve) d\'une première inspection '
    + '(ticket 014 — friction du rapport bout-en-bout : les deux étaient strictement '
    + 'identiques dans la liste)',
    async () => {
      const reserveId = 'aaaaaaaa-1111-2222-3333-444444444444';
      await seedFixtureMissions([
        { ...FIXTURE_MISSIONS[0], reserveId, reserveLatestEventId: 'evt-x' },
        FIXTURE_MISSIONS[1],
      ]);

      render(<MissionsListView onSelectMission={() => {}} />);
      await screen.findByText(FIXTURE_MISSIONS[0].lotName);

      const followUpItem = screen.getByText(FIXTURE_MISSIONS[0].lotName).closest('li');
      const firstMissionItem = screen.getByText(FIXTURE_MISSIONS[1].lotName).closest('li');

      expect(followUpItem).toHaveTextContent('Mission de suivi');
      // Référence courte de la réserve concernée — pas juste "mission de
      // suivi" sans plus de détail.
      expect(followUpItem).toHaveTextContent(reserveId.slice(0, 8));
      expect(firstMissionItem).toHaveTextContent('Première inspection');
      expect(firstMissionItem).not.toHaveTextContent('Mission de suivi');
    },
  );

  it('ticket F-069 — relit le cache quand la synchronisation le met à jour (premier affichage vide)', async () => {
    await clearIndexedDB();
    render(<MissionsListView onSelectMission={() => {}} />);
    expect(await screen.findByText('Aucune mission pour le moment.')).toBeInTheDocument();

    await seedFixtureMissions();
    window.dispatchEvent(new Event(MISSIONS_UPDATED_EVENT));

    expect(await screen.findByText(FIXTURE_MISSIONS[0].lotName)).toBeInTheDocument();
  });
});

describe(
  'MissionsListView — robustesse aux échecs IndexedDB (ticket F-033, vague 1)',
  () => {
    it('affiche un état de chargement explicite avant que le cache ne réponde', async () => {
      let resolveGetCachedMissions: ((value: typeof FIXTURE_MISSIONS) => void) | undefined;
      vi.spyOn(repository, 'getCachedMissions').mockImplementation(() => new Promise((resolve) => {
        resolveGetCachedMissions = resolve;
      }));

      render(<MissionsListView onSelectMission={() => {}} />);

      expect(screen.getByText('Chargement…')).toBeInTheDocument();
      expect(screen.queryByText('Aucune mission pour le moment.')).not.toBeInTheDocument();

      resolveGetCachedMissions!([]);
      await waitFor(() => expect(screen.getByText('Aucune mission pour le moment.')).toBeInTheDocument());
    });

    it(
      'un échec de lecture du cache de missions affiche une erreur explicite, jamais un '
      + 'état vide silencieux ni un blocage indéfini sur "Chargement…"',
      async () => {
        vi.spyOn(repository, 'getCachedMissions').mockRejectedValueOnce(new Error('IndexedDB indisponible'));

        render(<MissionsListView onSelectMission={() => {}} />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger vos missions.');
        expect(screen.queryByText('Aucune mission pour le moment.')).not.toBeInTheDocument();
        expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
      },
    );

    it(
      'l\'échec de lecture du statut de synchro d\'UNE mission ne prive pas les AUTRES du '
      + 'leur (Promise.allSettled, jamais Promise.all — reproduit le bug avant correctif)',
      async () => {
        // Ticket F-033 : brouillon réel pour la mission[0] (statut `pending`
        // attendu à l'écran) — la mission[1] n'a, elle, aucun brouillon.
        const draft = createEmptyDraft(FIXTURE_MISSIONS[0].id, [{ id: 'x', label: 'X', checked: false }]);
        await saveDraft(draft);

        const realGetDraftForMission = repository.getDraftForMission;
        vi.spyOn(repository, 'getDraftForMission').mockImplementation((missionId) => {
          if (missionId === FIXTURE_MISSIONS[1].id) {
            return Promise.reject(new Error('IndexedDB indisponible pour cette mission'));
          }
          return realGetDraftForMission(missionId);
        });

        render(<MissionsListView onSelectMission={() => {}} />);
        await screen.findByText(FIXTURE_MISSIONS[0].lotName);

        // La mission dont la lecture RÉUSSIT garde son vrai statut, malgré
        // l'échec de l'autre dans le même passage — avec `Promise.all` (bug
        // avant correctif), cette assertion échoue : AUCUNE mission n'a de
        // statut affiché, y compris celle-ci.
        await waitFor(() => expect(screen.getByText('En attente de synchronisation')).toBeInTheDocument());
      },
    );

    it('affiche un bouton "Réessayer" sur l\'erreur, qui redéclenche le chargement (ticket F-033, vague 3)', async () => {
      const getCachedMissions = vi.fn()
        .mockRejectedValueOnce(new Error('IndexedDB indisponible'))
        .mockResolvedValueOnce(FIXTURE_MISSIONS);
      vi.spyOn(repository, 'getCachedMissions').mockImplementation(getCachedMissions);

      render(<MissionsListView onSelectMission={() => {}} />);

      await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

      await screen.findByText(FIXTURE_MISSIONS[0].lotName);
      expect(getCachedMissions).toHaveBeenCalledTimes(2);
    });
  },
);

describe('MissionsListView — missions terminées et recontrôles (ticket F-077)', () => {
  it(
    'un contrôle déjà rendu et son recontrôle rendu ne s\'affichent plus comme deux missions à faire : '
    + 'ils rejoignent « Terminées », le second étiqueté « Recontrôle »',
    async () => {
      await clearIndexedDB();
      await seedFixtureMissions([
        { ...FIXTURE_MISSIONS[0], id: 'first', completed: true, followUp: false },
        { ...FIXTURE_MISSIONS[0], id: 'recontrol', completed: true, followUp: true },
        FIXTURE_MISSIONS[1],
      ]);
      const onSelectMission = vi.fn();
      render(<MissionsListView onSelectMission={onSelectMission} />);

      const done = await screen.findAllByTestId('completed-mission');
      expect(done).toHaveLength(2);
      expect(done.map((item) => item.querySelector('[data-testid="mission-type"]')!.getAttribute('data-mission-type')).sort())
        .toEqual(['first', 'recontrol']);
      expect(done.every((item) => item.textContent!.includes('Avis rendu'))).toBe(true);
      // Une mission rendue n'est plus un bouton : aucune seconde saisie possible depuis la liste.
      expect(done.some((item) => item.querySelector('button'))).toBe(false);

      // Seule la mission encore à faire reste cliquable.
      expect(screen.getAllByRole('button')).toHaveLength(1);
      fireEvent.click(screen.getByText(FIXTURE_MISSIONS[1].lotName));
      expect(onSelectMission).toHaveBeenCalledWith(FIXTURE_MISSIONS[1].id);
    },
  );

  it('toutes les missions rendues : message explicite, jamais une liste vide ambiguë', async () => {
    await clearIndexedDB();
    await seedFixtureMissions([{ ...FIXTURE_MISSIONS[0], completed: true }]);
    render(<MissionsListView onSelectMission={() => {}} />);

    expect(await screen.findByTestId('no-pending-missions')).toBeInTheDocument();
    expect(screen.getAllByTestId('completed-mission')).toHaveLength(1);
  });
});

describe('MissionsListView — résultat de l’avis et identité de la mission (audit UI R1, K05/D03)', () => {
  it('K05 : une mission terminée affiche le résultat et ses réserves, pas seulement « Avis rendu »', async () => {
    await seedFixtureMissions([{
      ...FIXTURE_MISSIONS[0],
      completed: true,
      assignedAt: '2026-09-27T19:37:00Z',
      outcome: {
        outcome: 'avec_reserve', outcomeLabel: 'Avec réserve', recordedAt: '2026-09-27T20:05:00Z',
        reservesOpened: 2, reservesLifted: 0, reservesMaintained: 0,
      },
    }]);
    render(<MissionsListView onSelectMission={() => {}} />);

    expect(await screen.findByTestId('mission-outcome')).toHaveTextContent('Avis rendu : Non conforme · 2 réserves ouvertes');
    expect(screen.getByText('Avis enregistré le 27 sept. 2026, 20:05 (GMT, Abidjan)')).toBeInTheDocument();
  });

  it('D03 : chaque mission porte son identifiant et sa date d’affectation', async () => {
    await seedFixtureMissions([{ ...FIXTURE_MISSIONS[0], assignedAt: '2026-09-27T19:37:00Z' }]);
    render(<MissionsListView onSelectMission={() => {}} />);

    const identities = await screen.findAllByTestId('mission-identity');
    expect(identities[0]).toHaveTextContent(`Mission #${FIXTURE_MISSIONS[0].id.slice(0, 8)} · affectée le 27 sept. 2026, 19:37 (GMT, Abidjan)`);
  });

  it('outcomeSummary : conforme avec levées et maintiens, accords au pluriel', () => {
    expect(outcomeSummary({
      outcome: 'conforme', outcomeLabel: 'Conforme', recordedAt: '', reservesOpened: 0, reservesLifted: 1, reservesMaintained: 0,
    })).toBe('Conforme · 1 réserve levée');
    expect(outcomeSummary({
      outcome: 'avec_reserve', outcomeLabel: 'Avec réserve', recordedAt: '', reservesOpened: 0, reservesLifted: 2, reservesMaintained: 1,
    })).toBe('Non conforme · 2 réserves levées · 1 réserve maintenue');
  });
});

describe('MissionsListView — rafraîchissement en ligne (PO-2026-09-28-51)', () => {
  it('relit la liste au retour sur la fenêtre : une mission affectée entre-temps apparaît', async () => {
    const loadMissions = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([FIXTURE_MISSIONS[0]]);
    render(<MissionsListView onSelectMission={() => {}} loadMissions={loadMissions} />);
    await waitFor(() => expect(loadMissions).toHaveBeenCalledTimes(1));

    fireEvent.focus(window);

    await waitFor(() => expect(loadMissions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(FIXTURE_MISSIONS[0].lotName, { exact: false })).toBeInTheDocument();
  });
});
