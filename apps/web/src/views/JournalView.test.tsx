import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { JournalView } from './JournalView';

describe('JournalView (audit R02) — journal en lecture seule', () => {
  it('liste les actes sans proposer aucune action', async () => {
    const api = createMockApiClient({
      getAdminJournal: vi.fn().mockResolvedValue([{
        id: 1, created_at: '2026-09-27T11:48:00Z', organization: 'Promoteur', actor: 'client1.demo@keya.test',
        action: 'reservation.held', object_type: 'sales.reservation', object_id: '0f0e0d0c-0000-0000-0000-000000000000',
        justification: '',
      }]),
    });
    render(withApiClient(api, <JournalView />));

    const table = await screen.findByTestId('journal-table');
    expect(table).toHaveTextContent('reservation.held');
    expect(table).toHaveTextContent('client1.demo@keya.test');
    expect(table).toHaveTextContent('27 sept. 2026');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Lecture seule/)).toBeInTheDocument();
  });

  it('lot 4 (PO-2026-09-28-67, P17 en partie) — l’action est lue en libellé métier', async () => {
    const api = createMockApiClient({
      getAdminJournal: vi.fn().mockResolvedValue([{
        id: 2, created_at: '2026-09-27T11:48:00Z', organization: 'Promoteur', actor: 'KEYIMMO AFRIC (démo) · Gestionnaire',
        action: 'reservation.validated', action_label: 'Dossier examiné', object_type: 'sales.reservation',
        object_id: '0f0e0d0c-0000-0000-0000-000000000000', justification: '',
      }]),
    });
    render(withApiClient(api, <JournalView />));

    const table = await screen.findByTestId('journal-table');
    expect(table).toHaveTextContent('Dossier examiné');
    expect(table).not.toHaveTextContent('reservation.validated');
  });
});
