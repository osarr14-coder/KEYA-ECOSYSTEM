import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §12) : état vide = une phrase utile et la
 * prochaine action, jamais une illustration décorative.
 */
export interface EmptyStateProps {
  message: string;
  action?: ReactNode;
  'data-testid'?: string;
}

export function EmptyState({ message, action, 'data-testid': testId = 'empty-state' }: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px', borderRadius: '6px', border: `1px dashed ${semanticColors.neutral.border}`,
      }}
    >
      <p style={{ margin: 0, color: semanticColors.neutral.text }}>{message}</p>
      {action}
    </div>
  );
}
