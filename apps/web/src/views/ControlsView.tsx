import { useState } from 'react';

import {
  ApiErrorBanner, Button, Card, Select,
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
 */

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Abidjan' });
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
    <Card title={`${control.program.name} — ${control.lot.name} — ${control.milestone.label}`} icon="clipboard-check">
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0 }}>
        <dt>État</dt>
        <dd style={{ margin: 0 }} data-testid="control-status">{control.status_label}</dd>
        <dt>Organisation</dt>
        <dd style={{ margin: 0 }}>{control.organization.name}</dd>
        <dt>Déclaré le</dt>
        <dd style={{ margin: 0 }}>{formatDate(control.declared_at)}</dd>
        <dt>Pièces</dt>
        <dd style={{ margin: 0 }}>{control.evidence_count}</dd>
        {control.status === 'under_reserve' && (
          <>
            <dt>Correction</dt>
            <dd style={{ margin: 0 }}>{control.correction_submitted ? 'Proposée par le constructeur' : 'Pas encore proposée'}</dd>
          </>
        )}
      </dl>
      {control.pending_mission ? (
        <p style={{ margin: '8px 0 0' }} data-testid="control-mission">
          {`Mission en cours : ${control.pending_mission.inspector_email}, affectée le ${formatDate(control.pending_mission.assigned_at)}`}
        </p>
      ) : (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '8px' }}>
          <label>
            Contrôleur
            <Select
              aria-label={`Contrôleur pour ${control.lot.name} ${control.milestone.label}`}
              value={inspectorId}
              onChange={(event) => setInspectorId(event.target.value)}
              style={{ marginTop: '4px' }}
            >
              {inspectors.map((inspector) => (
                <option key={inspector.id} value={inspector.id}>
                  {`${inspector.full_name || inspector.email} — ${inspector.organizations.join(', ')}`}
                </option>
              ))}
            </Select>
          </label>
          <Button type="button" disabled={pending || inspectorId === ''} onClick={() => { void assign(); }}>
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
      <h2>Contrôles à affecter</h2>
      {state.status === 'loading' && <p>Chargement…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger les contrôles." onRetry={state.refetch} />
      )}
      {state.status === 'success' && (() => {
        const [controls, inspectors] = state.data;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
