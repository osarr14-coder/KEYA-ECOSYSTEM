import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockApiClient, withApiClient } from '../testUtils';
import { EvidenceFeedView } from './EvidenceFeedView';

const FEED = [
  {
    id: 'evidence-2', milestone_code: 'conception', milestone_label: 'Conception',
    added_by: 'constructeur@example.com', created_at: '2026-03-06T09:00:00Z', document_count: 1,
    documents: [{ category: 'plan', source: 'document_upload', captured_at: null }],
    status: {
      level: 'documente' as const, source: 'evidence_upload', actor: 'constructeur@example.com',
      scope: '', created_at: '2026-03-06T09:00:00Z',
    },
  },
  {
    id: 'evidence-1', milestone_code: 'foncier', milestone_label: 'Foncier',
    added_by: 'constructeur@example.com', created_at: '2026-03-05T09:00:00Z', document_count: 1,
    documents: [{ category: 'photo', source: 'mobile_app_photo', captured_at: '2026-03-05T08:55:00Z' }],
    status: {
      level: 'documente' as const, source: 'evidence_upload', actor: 'constructeur@example.com',
      scope: '', created_at: '2026-03-05T09:00:00Z',
    },
  },
];

describe('EvidenceFeedView', () => {
  it("affiche la liste dans l'ordre reçu de l'API, sans la retrier localement", async () => {
    const api = createMockApiClient({ getLotEvidenceFeed: async () => FEED });

    render(withApiClient(api, <EvidenceFeedView lotId="lot-1" />));

    const items = await screen.findAllByRole('listitem');
    // Deux <ul> imbriquées (jalon + documents) — on ne garde que les items
    // de premier niveau (les preuves), identifiables par leur label de jalon.
    const milestoneItems = items.filter((item) => /Conception|Foncier/.test(item.textContent ?? ''));
    expect(milestoneItems[0]).toHaveTextContent('Conception');
    expect(milestoneItems[1]).toHaveTextContent('Foncier');
  });

  it('affiche un StatusBadge et la provenance pour chaque preuve', async () => {
    const api = createMockApiClient({ getLotEvidenceFeed: async () => FEED });

    render(withApiClient(api, <EvidenceFeedView lotId="lot-1" />));

    await screen.findByText('Conception');
    const badges = screen.getAllByText('Documenté');
    expect(badges).toHaveLength(2);
    expect(screen.getByText(/mobile_app_photo/)).toBeInTheDocument();
    expect(screen.getByText(/document_upload/)).toBeInTheDocument();
  });

  it('affiche un message explicite quand aucune preuve n\'existe encore', async () => {
    const api = createMockApiClient({ getLotEvidenceFeed: async () => [] });

    render(withApiClient(api, <EvidenceFeedView lotId="lot-1" />));

    expect(await screen.findByText(/aucune preuve/i)).toBeInTheDocument();
  });
});
