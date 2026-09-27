import { type FormEvent, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Select, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { LotMilestone } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-069 — jalons d'un lot côté constructeur (backend B-054, CDC V3
 * §7.1) : déclarer, joindre des pièces, proposer une correction sur une
 * réserve. Le constructeur ne lève jamais une réserve et un dépôt n'accepte
 * jamais les travaux : l'état affiché est dérivé par le serveur (contrôle,
 * réserve, acceptation), jamais décidé ici.
 */

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

function FileAction({
  label, submitLabel, onSubmit,
}: { label: string; submitLabel: string; onSubmit: (file: File) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(file);
    } catch (caught) {
      setError(errorMessage(caught, "Échec de l'envoi."));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' }}
    >
      <input
        type="file"
        aria-label={label}
        accept="application/pdf,image/jpeg,image/png"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <Button type="submit" variant="secondary" disabled={!file || submitting}>
        {submitting ? 'Envoi…' : submitLabel}
      </Button>
      {error && <div style={{ width: '100%' }}><AlertBanner title={error} /></div>}
    </form>
  );
}

function MilestoneRow({ milestone, onChanged }: { milestone: LotMilestone; onChanged: () => void }) {
  const api = useApiClient();
  const [declaring, setDeclaring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function declare() {
    setDeclaring(true);
    setError(null);
    try {
      await api.declareMilestone(milestone.id);
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught, 'Échec de la déclaration.'));
      setDeclaring(false);
    }
  }

  async function addEvidence(file: File) {
    await api.addEvidenceDocument({
      workDeclarationId: milestone.work_declaration_id as string,
      file,
      category: 'preuve_chantier',
      source: 'control_tower_upload',
    });
    onChanged();
  }

  async function proposeCorrection(file: File) {
    const { evidenceId } = await api.addEvidenceDocument({
      workDeclarationId: milestone.work_declaration_id as string,
      file,
      category: 'preuve_chantier',
      source: 'control_tower_upload',
    });
    await api.createReserveCorrection(milestone.reserve_id as string, evidenceId);
    onChanged();
  }

  return (
    <li
      aria-label={`Jalon ${milestone.label}`}
      style={{
        padding: '12px',
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '14px',
      }}
    >
      <strong>{`${milestone.order}. ${milestone.label}`}</strong>
      {' · '}
      <span data-testid={`milestone-status-${milestone.code}`}>{milestone.status_label}</span>
      {milestone.evidence_count > 0 && ` · ${milestone.evidence_count} pièce(s)`}
      {milestone.control_scheduled && ' · contrôle planifié'}

      {milestone.status === 'not_declared' && (
        <div style={{ marginTop: '8px' }}>
          <Button type="button" onClick={() => { void declare(); }} disabled={declaring}>
            {declaring ? 'Déclaration…' : 'Déclarer ce jalon'}
          </Button>
        </div>
      )}
      {milestone.status === 'awaiting_documents' && (
        <>
          <p style={{ margin: '4px 0 0' }}>Joignez au moins une pièce : une déclaration sans pièce n&apos;est pas contrôlée.</p>
          <FileAction label={`Pièce pour ${milestone.label}`} submitLabel="Joindre la pièce" onSubmit={addEvidence} />
        </>
      )}
      {milestone.status === 'awaiting_control' && (
        <>
          <p style={{ margin: '4px 0 0' }}>
            {milestone.control_scheduled
              ? 'Le bureau de contrôle est missionné.'
              : 'En attente de l’affectation d’un contrôleur par KEYIMMO.'}
          </p>
          <FileAction label={`Pièce pour ${milestone.label}`} submitLabel="Ajouter une pièce" onSubmit={addEvidence} />
        </>
      )}
      {milestone.status === 'under_reserve' && (
        milestone.correction_submitted ? (
          <p style={{ margin: '4px 0 0' }}>Correction proposée : en attente du recontrôle (seul le contrôleur lève la réserve).</p>
        ) : (
          <>
            <p style={{ margin: '4px 0 0' }}>Réserve ouverte : proposez une correction avec une nouvelle pièce.</p>
            <FileAction
              label={`Correction pour ${milestone.label}`}
              submitLabel="Proposer la correction"
              onSubmit={proposeCorrection}
            />
          </>
        )
      )}
      {milestone.status === 'accepted' && (
        <p style={{ margin: '4px 0 0' }}>Validé techniquement — démonstration (avis conforme, aucune réserve ouverte).</p>
      )}
      {error && <div style={{ marginTop: '8px' }}><AlertBanner title={error} /></div>}
    </li>
  );
}

function LotMilestones({ lotId }: { lotId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.listLotMilestones(lotId), [lotId]);

  if (state.status === 'loading') return <p>Chargement des jalons…</p>;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger les jalons." onRetry={state.refetch} />;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {state.data.map((milestone) => (
        <MilestoneRow
          key={`${milestone.id}-${milestone.status}-${milestone.evidence_count}-${milestone.correction_submitted}`}
          milestone={milestone}
          onChanged={state.refetch}
        />
      ))}
    </ul>
  );
}

export function MilestonesView({ activeOrganizationId }: { activeOrganizationId: string | null }) {
  const api = useApiClient();
  const lotsState = useApiResource(
    () => api.getAllLots({ page_size: 100 }),
    [activeOrganizationId],
  );
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

  return (
    <section aria-label="Jalons">
      <h2>Jalons</h2>
      {lotsState.status === 'loading' && <p>Chargement…</p>}
      {lotsState.status === 'error' && (
        <ApiErrorBanner error={lotsState.error} title="Impossible de charger vos lots." onRetry={lotsState.refetch} />
      )}
      {lotsState.status === 'success' && lotsState.data.results.length === 0 && (
        <p data-testid="no-lots">Aucun lot dans cette organisation.</p>
      )}
      {lotsState.status === 'success' && lotsState.data.results.length > 0 && (() => {
        const lots = lotsState.data.results;
        const lotId = selectedLotId && lots.some((lot) => lot.id === selectedLotId) ? selectedLotId : lots[0].id;
        return (
          <>
            <label style={{ display: 'block', marginBottom: '12px' }}>
              Lot
              <Select
                aria-label="Choisir un lot"
                value={lotId}
                onChange={(event) => setSelectedLotId(event.target.value)}
                style={{ marginTop: '4px', maxWidth: '420px' }}
              >
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>{`${lot.program_name} — ${lot.name}`}</option>
                ))}
              </Select>
            </label>
            <LotMilestones key={lotId} lotId={lotId} />
          </>
        );
      })()}
    </section>
  );
}
