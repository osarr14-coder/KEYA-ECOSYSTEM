import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getViewedArchive, setViewedArchive } from '../api/archiveView';
import type { InstancesOverview } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { InstancesView } from './InstancesView';

/** Lot 5 — instances et archives (PO-2026-09-29-01, -03, -04). */

function overview(overrides: Partial<InstancesOverview> = {}): InstancesOverview {
  return {
    campaign_end: null,
    retention_days: 90,
    instances: [
      {
        code: 'DEMO-CI-NOUVELLE', status: 'ACTIVE', status_label: 'Active', dataset_version: 'DEMO-CI-v2',
        created_at: '2026-09-29T08:00:00Z', archived_at: null, origin: 'DEMO-CI-ANCIENNE', retention_until: null,
        retention_expired: false,
      },
      {
        code: 'DEMO-CI-ANCIENNE', status: 'ARCHIVED', status_label: 'Archivée', dataset_version: 'DEMO-CI-v2',
        created_at: '2026-09-28T08:00:00Z', archived_at: '2026-09-29T08:00:00Z', origin: null, retention_until: null,
        retention_expired: false,
      },
    ],
    ...overrides,
  };
}

function renderView({ canArchive = true, ...overrides }: Parameters<typeof createMockApiClient>[0] & { canArchive?: boolean } = {}) {
  const onConsult = vi.fn();
  const api = createMockApiClient({ getInstances: vi.fn().mockResolvedValue(overview()), ...overrides });
  render(withApiClient(api, <InstancesView canArchive={canArchive} onConsult={onConsult} />));
  return { api, onConsult };
}

afterEach(() => setViewedArchive(null));

describe('InstancesView — archivage et archives (lot 5)', () => {
  it('l’administrateur archive après avoir saisi le code exact de l’instance active', async () => {
    const archiveInstance = vi.fn().mockResolvedValue({
      archived: { code: 'DEMO-CI-NOUVELLE', dataset_version: 'DEMO-CI-v2', status: 'ARCHIVED', environment: 'DEMO', created_at: '' },
      created: { code: 'DEMO-CI-SUIVANTE', dataset_version: 'DEMO-CI-v2', status: 'ACTIVE', environment: 'DEMO', created_at: '' },
    });
    const { api } = renderView({ archiveInstance });

    fireEvent.click(await screen.findByRole('button', { name: 'Archiver et créer une nouvelle instance' }));
    const confirm = screen.getByRole('button', { name: 'Archiver et créer la nouvelle instance' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Pour confirmer, saisissez le code de l’instance'), { target: { value: 'DEMO-CI-AUTRE' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Pour confirmer, saisissez le code de l’instance'), { target: { value: 'DEMO-CI-NOUVELLE' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(api.archiveInstance).toHaveBeenCalledWith('DEMO-CI-NOUVELLE'));
    expect(await screen.findByRole('status')).toHaveTextContent('nouvelle instance DEMO-CI-SUIVANTE créée');
  });

  it('le gestionnaire consulte une archive mais ne peut pas archiver', async () => {
    const { onConsult } = renderView({ canArchive: false });

    fireEvent.click(await screen.findByRole('button', { name: 'Consulter l’archive DEMO-CI-ANCIENNE' }));

    expect(screen.queryByRole('button', { name: 'Archiver et créer une nouvelle instance' })).not.toBeInTheDocument();
    expect(getViewedArchive()).toEqual({ code: 'DEMO-CI-ANCIENNE', archived_at: '2026-09-29T08:00:00Z' });
    expect(onConsult).toHaveBeenCalledTimes(1);
  });

  it('la conservation suit la fin de campagne (A6) et signale une archive échue', async () => {
    const data = overview({ campaign_end: '2026-06-30' });
    data.instances[1] = { ...data.instances[1], retention_until: '2026-09-28', retention_expired: true };
    renderView({ getInstances: vi.fn().mockResolvedValue(data) });

    expect(await screen.findByTestId('retention')).toHaveTextContent('conservée 90 jours de plus');
    expect(screen.getByTestId('archive-row')).toHaveTextContent('Échue');
  });
});
