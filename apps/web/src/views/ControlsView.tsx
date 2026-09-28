import { useState } from 'react';

import {
  ApiErrorBanner, Button, Card, KeyFigure, PageHeader, Pill, Select, semanticColors, formatServerDateTime,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { ControlToAssign, InspectorSummary } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-069 — contrôles à affecter (backend B-054, CDC V3 §7.1) :
 * déclarations documentées en attente de contrôle ou sous réserve, toutes
 * organisations. L'admin KEYIMMO missionne un contrôleur ; le constructeur
 * ne choisit jamais son contrôleur (règle d'indépendance, ticket 012),
 * vérifiée par le serveur à l'affectation (refus affiché tel quel).
 *
 * Ticket F-078 (direction « Confiance premium ») — en-tête, chiffres clés,
 * état en pastille, « Missionner » en bouton or.
 */

// Audit UI R1 (F06) : format de date unique, fuseau indiqué.
function formatDate(iso: string) {
  return formatServerDateTime(iso);
}

function ControlCard({
  control, inspectors, onAssigned,
}: { control: ControlToAssign; inspectors: InspectorSummary[]; onAssigned: () => void }) {
  const api = useApiClient();
  const [inspectorId, setInspectorId] = useState(inspectors[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    setPending(true);
    setError(null);
    try {
      await api.assignMission(control.organization.id, control.work_declaration_id, inspectorId);
      onAssigned();
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, "Échec de l'affectation."));
      setPending(false);
    }
  }

  return (
    <Card
      title={`${control.program.name} — ${control.lot.name} — ${control.milestone.label}`}
      icon="clipboard-check"
      action={(
        <Pill tone={control.status === 'under_reserve' ? 'danger' : 'info'} data-testid="control-status">
          {control.status_label}
        </Pill>
      )}
    >
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 20px', margin: 0 }}>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Organisation</dt>
        <dd style={{ margin: 0 }}>{control.organization.name}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Déclaré le</dt>
        <dd style={{ margin: 0 }}>{formatDate(control.declared_at)}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Pièces</dt>
        <dd style={{ margin: 0 }}>{control.evidence_count}</dd>
        {control.status === 'under_reserve' && (
          <>
            <dt style={{ color: semanticColors.neutral.textMuted }}>Correction</dt>
            <dd style={{ margin: 0 }}>{control.correction_submitted ? 'Proposée par le constructeur' : 'Pas encore proposée'}</dd>
          </>
        )}
      </dl>
      {control.pending_mission ? (
        <p
          style={{
            margin: '16px 0 0', padding: '12px 14px', borderRadius: '6px', background: semanticColors.neutral.subtle,
            display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
          }}
        >
          <Pill tone="primary">Mission en cours</Pill>
          <span data-testid="control-mission">
            {`Mission en cours : ${control.pending_mission.inspector}, affectée le ${formatDate(control.pending_mission.assigned_at)}`}
          </span>
        </p>
      ) : (
        <div
          style={{
            display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '16px', paddingTop: '16px',
            borderTop: `1px solid ${semanticColors.neutral.border}`,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600, flex: '1 1 280px', maxWidth: '460px' }}>
            Contrôleur
            <Select
              aria-label={`Contrôleur pour ${control.lot.name} ${control.milestone.label}`}
              value={inspectorId}
              onChange={(event) => setInspectorId(event.target.value)}
            >
              {inspectors.map((inspector) => (
                <option key={inspector.id} value={inspector.id}>
                  {inspector.label}
                </option>
              ))}
            </Select>
          </label>
          <Button type="button" variant="accent" disabled={pending || inspectorId === ''} onClick={() => { void assign(); }}>
            {pending ? 'Affectation…' : 'Missionner'}
          </Button>
        </div>
      )}
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </Card>
  );
}

export function ControlsView() {
  const api = useApiClient();
  const state = useApiResource(() => Promise.all([api.listControlsToAssign(), api.listInspectors()]), []);

  return (
    <section aria-label="Contrôles à affecter">
      <PageHeader
        title="Contrôles à affecter"
        subtitle="Déclarations documentées en attente de contrôle ou sous réserve. KEYIMMO missionne le contrôleur ; le constructeur ne le choisit jamais."
      />
      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger les contrôles." onRetry={state.refetch} />
      )}
      {state.status === 'success' && (() => {
        const [controls, inspectors] = state.data;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <KeyFigure
                label="À missionner"
                value={controls.filter((control) => !control.pending_mission).length}
                tone={controls.some((control) => !control.pending_mission) ? 'accent' : 'neutral'}
                data-testid="kf-to-assign"
              />
              <KeyFigure label="Missions en cours" value={controls.filter((control) => control.pending_mission).length} data-testid="kf-in-progress" />
              <KeyFigure
                label="Sous réserve"
                value={controls.filter((control) => control.status === 'under_reserve').length}
                data-testid="kf-under-reserve"
              />
            </div>
            {inspectors.length === 0 && <p>Aucun compte ne détient le rôle contrôleur.</p>}
            {controls.length === 0 && <p>Aucune déclaration en attente de contrôle.</p>}
            {controls.map((control) => (
              <ControlCard
                key={`${control.work_declaration_id}-${control.status}-${control.pending_mission?.id ?? ''}`}
                control={control}
                inspectors={inspectors}
                onAssigned={state.refetch}
              />
            ))}
          </div>
        );
      })()}
    </section>
  );
}
