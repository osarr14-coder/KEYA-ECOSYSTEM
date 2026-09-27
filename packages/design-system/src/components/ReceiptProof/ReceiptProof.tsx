import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';
import { DateTime } from '../DateTime/DateTime';
import { Money } from '../Money/Money';
import { Pill } from '../Pill/Pill';
import { Reference } from '../Reference/Reference';
import { SimulatedMark } from '../SimulatedMark/SimulatedMark';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §10) : justificatif bancaire FICTIF d'un
 * encaissement, composant unique (il existait en deux copies dans
 * apps/web). Toujours accompagné du marqueur « SIMULÉ ». Le non affecté est
 * toujours affiché, en gras quand il est non nul.
 */
export interface ReceiptProofAllocation {
  id: string;
  label: string;
  amount: string;
}

export interface ReceiptProofProps {
  bankReference: string;
  amount: string;
  currency: string;
  receivedOn: string;
  recordedBy: string;
  recordedAt: string;
  statusLabel: string;
  reconciled: boolean;
  allocations: ReceiptProofAllocation[];
  unallocatedAmount: string;
  /** Actions éventuelles (affecter le solde…), sous le justificatif. */
  children?: ReactNode;
  'data-testid'?: string;
}

export function ReceiptProof({
  bankReference, amount, currency, receivedOn, recordedBy, recordedAt, statusLabel, reconciled, allocations,
  unallocatedAmount, children, 'data-testid': testId = 'receipt-proof',
}: ReceiptProofProps) {
  const muted = { color: semanticColors.neutral.textMuted } as const;
  return (
    <section
      aria-label={`Justificatif bancaire fictif ${bankReference}`}
      data-testid={testId}
      style={{
        display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px',
        border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '6px', background: semanticColors.neutral.subtle,
      }}
    >
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>Justificatif bancaire fictif</strong>
        <Pill tone={reconciled ? 'success' : 'info'} data-testid="receipt-status">{statusLabel}</Pill>
        <SimulatedMark detail="Encaissement" />
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '6px 20px', margin: 0 }}>
        <dt style={muted}>Référence bancaire simulée</dt>
        <dd style={{ margin: 0 }}><Reference value={bankReference} label="Référence bancaire simulée" data-testid="receipt-bank-reference" /></dd>
        <dt style={muted}>Montant reçu</dt>
        <dd style={{ margin: 0 }}><Money value={amount} currency={currency} kind="received" /></dd>
        <dt style={muted}>Reçu le</dt>
        <dd style={{ margin: 0 }}><DateTime value={receivedOn} mode="date" /></dd>
        <dt style={muted}>Enregistré par</dt>
        <dd style={{ margin: 0 }}>{`${recordedBy}, le `}<DateTime value={recordedAt} /></dd>
        <dt style={muted}>Affectations</dt>
        <dd style={{ margin: 0 }}>
          {allocations.length === 0 ? 'Aucune' : (
            <ul style={{ margin: 0, paddingLeft: '18px' }} data-testid="receipt-allocations">
              {allocations.map((allocation) => (
                <li key={allocation.id}>
                  <Money value={allocation.amount} currency={currency} kind="allocated" />
                  {` → ${allocation.label}`}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt style={muted}>Non affecté</dt>
        <dd style={{ margin: 0 }} data-testid="receipt-unallocated">
          <Money value={unallocatedAmount} currency={currency} kind="unallocated" />
        </dd>
      </dl>
      {children}
    </section>
  );
}
