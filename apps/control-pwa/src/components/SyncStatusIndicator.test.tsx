import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SyncStatusIndicator } from './SyncStatusIndicator';

describe('SyncStatusIndicator', () => {
  it.each([
    ['pending', 'En attente de synchronisation'],
    ['syncing', 'Synchronisation en cours'],
    ['synced', 'Synchronisé'],
    ['conflict', 'Conflit à résoudre'],
  ] as const)('affiche le libellé attendu pour le statut %s', (status, expectedLabel) => {
    render(<SyncStatusIndicator status={status} />);
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    expect(screen.getByTestId('sync-status')).toHaveAttribute('data-status', status);
  });
});
