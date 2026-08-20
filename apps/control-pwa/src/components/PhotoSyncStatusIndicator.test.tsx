import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PhotoSyncStatusIndicator } from './PhotoSyncStatusIndicator';

describe('PhotoSyncStatusIndicator', () => {
  it.each([
    ['pending', "En attente d'envoi"],
    ['syncing', 'Envoi en cours'],
    ['synced', 'Envoyée'],
    ['failed', "Échec d'envoi — nouvelle tentative automatique"],
  ] as const)('affiche le libellé attendu pour le statut %s', (status, expectedLabel) => {
    render(<PhotoSyncStatusIndicator status={status} />);
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    expect(screen.getByTestId('photo-sync-status')).toHaveAttribute('data-status', status);
  });
});
