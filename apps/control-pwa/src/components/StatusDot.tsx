/**
 * Ticket F-033 (vague 4) — scaffolding visuel partagé (pastille + libellé)
 * extrait de `SyncStatusIndicator` (ticket 010) au moment où
 * `PhotoSyncStatusIndicator` en devient un second consommateur réel : même
 * forme exacte (pastille colorée + texte, jamais la couleur seule), mais
 * deux domaines de valeurs distincts (`SyncStatus` du brouillon vs
 * `MediaSyncStatus` d'une photo, voir chaque indicateur pour le détail).
 * Composant interne, pas exporté du package design-system — aucun
 * consommateur hors de cette app à ce jour (contrairement à AlertBanner).
 */
export interface StatusDotProps {
  status: string;
  label: string;
  color: string;
  testId: string;
}

export function StatusDot({
  status, label, color, testId,
}: StatusDotProps) {
  return (
    <span
      data-testid={testId}
      data-status={status}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
          background: color,
        }}
      />
      {label}
    </span>
  );
}
