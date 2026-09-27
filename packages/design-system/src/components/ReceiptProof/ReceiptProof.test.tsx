import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReceiptProof } from './ReceiptProof';

describe('ReceiptProof — justificatif fictif unique (PO-2026-09-27-20, §10)', () => {
  it('marqué simulé, référence en Plex Mono, non affecté visible et en gras', () => {
    render(
      <ReceiptProof
        bankReference="VIR-SIM-0001"
        amount="1500000"
        currency="XOF"
        receivedOn="2026-09-28"
        recordedBy="Finance Démo"
        recordedAt="2026-09-28T09:00:00Z"
        statusLabel="Exécuté par la banque (simulé)"
        reconciled={false}
        allocations={[{ id: 'a1', label: 'Frais de réservation', amount: '1000000' }]}
        unallocatedAmount="500000"
      />,
    );
    expect(screen.getByTestId('simulated-mark')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-bank-reference')).toHaveTextContent('VIR-SIM-0001');
    expect(screen.getByTestId('receipt-bank-reference').tagName).toBe('CODE');
    expect(screen.getByTestId('receipt-proof')).toHaveTextContent('28 sept. 2026');
    const unallocated = screen.getByTestId('receipt-unallocated').firstElementChild!;
    expect(unallocated.textContent).toBe('500\u202F000 XOF');
    expect(unallocated).toHaveStyle({ fontWeight: '700' });
  });
});
