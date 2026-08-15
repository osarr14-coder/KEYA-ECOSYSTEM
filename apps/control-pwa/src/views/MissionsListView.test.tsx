import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_MISSIONS } from '../db/missions';
import { createEmptyDraft, saveDraft } from '../db/repository';
import { MissionsListView } from './MissionsListView';

beforeEach(async () => {
  const databases = await indexedDB.databases();
  for (const database of databases) {
    if (database.name) indexedDB.deleteDatabase(database.name);
  }
});

describe('MissionsListView', () => {
  it('affiche toutes les missions', () => {
    render(<MissionsListView onSelectMission={() => {}} />);
    for (const mission of MOCK_MISSIONS) {
      expect(screen.getByText(mission.lotName)).toBeInTheDocument();
    }
  });

  it('sélectionner une mission déclenche onSelectMission avec son id', () => {
    const onSelectMission = vi.fn();
    render(<MissionsListView onSelectMission={onSelectMission} />);

    fireEvent.click(screen.getByText(MOCK_MISSIONS[0].lotName));

    expect(onSelectMission).toHaveBeenCalledWith(MOCK_MISSIONS[0].id);
  });

  it('affiche le statut de synchronisation d\'une mission déjà entamée', async () => {
    const draft = createEmptyDraft(MOCK_MISSIONS[0].id, [{ id: 'x', label: 'X', checked: false }]);
    await saveDraft(draft);

    render(<MissionsListView onSelectMission={() => {}} />);

    expect(await screen.findByText('En attente de synchronisation')).toBeInTheDocument();
  });

  it('n\'affiche aucun statut pour une mission jamais entamée', async () => {
    render(<MissionsListView onSelectMission={() => {}} />);

    await screen.findByText(MOCK_MISSIONS[0].lotName);
    expect(screen.queryByText('En attente de synchronisation')).not.toBeInTheDocument();
  });
});
