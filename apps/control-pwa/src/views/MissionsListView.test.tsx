import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyDraft, saveDraft } from '../db/repository';
import { clearIndexedDB } from '../testUtils/clearIndexedDB';
import { FIXTURE_MISSIONS, seedFixtureMissions } from '../testUtils/missionFixtures';
import { MissionsListView } from './MissionsListView';

beforeEach(async () => {
  await clearIndexedDB();
  // Ticket 012 : la liste vient désormais du cache local (`getCachedMissions`),
  // jamais de `MOCK_MISSIONS` (retiré) — peuplé ici pour chaque test.
  await seedFixtureMissions();
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
});
