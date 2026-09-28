import { type FormEvent, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Icon, CONTROLLER_DESIGNATION, Card, PageHeader, Pill, type PillTone, Select, TrustLevels,
  semanticColors,
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
      {/* PO-2026-09-28-05 : tuile tactile de 44 px au lieu du champ fichier
          natif (21 px, débordait à 375 px) ; le champ reste le vrai contrôle
          accessible, focus visible par `.keya-file-drop` (GlobalStyles). */}
      <label
        className="keya-file-drop"
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '8px', minHeight: '44px',
          maxWidth: '100%', boxSizing: 'border-box', padding: '0 14px', borderRadius: '4px',
          border: `1px dashed ${semanticColors.neutral.heading}`, color: semanticColors.neutral.heading,
          fontWeight: 600, cursor: 'pointer', overflow: 'hidden',
        }}
      >
        <Icon name="file-text" size={18} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file ? file.name : 'Choisir une pièce (PDF, JPEG, PNG)'}
        </span>
        <input
          type="file"
          aria-label={label}
          accept="application/pdf,image/jpeg,image/png"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
        />
      </label>
      <Button type="submit" variant="secondary" disabled={!file || submitting}>
        {submitting ? 'Envoi…' : submitLabel}
      </Button>
      {error && <div style={{ width: '100%' }}><AlertBanner title={error} /></div>}
    </form>
  );
}

const STATUS_TONE: Record<LotMilestone['status'], PillTone> = {
  not_declared: 'neutral',
  awaiting_documents: 'alert',
  awaiting_control: 'info',
  under_reserve: 'danger',
  accepted: 'success',
};

/** PO-2026-09-27-20 (DESIGN_SYSTEM §8.2, A-DS-4) : famille de couleur de
 * l'état CDC §7.1 ; un brouillon qui attend une pièce reste « action
 * attendue ». */
function milestoneTone(milestone: LotMilestone): PillTone {
  switch (milestone.cdc_state) {
    case 'DRAFT': return milestone.status === 'awaiting_documents' ? 'alert' : 'neutral';
    case 'SUBMITTED': return 'alert';
    case 'UNDER_REVIEW': return 'info';
    case 'CHANGES_REQUESTED': return 'alert';
    case 'RESUBMITTED': return 'info';
    case 'TECHNICALLY_ACCEPTED': return 'success';
    default: return STATUS_TONE[milestone.status];
  }
}

const STATUS_BAR: Record<LotMilestone['status'], string> = {
  not_declared: semanticColors.neutral.border,
  awaiting_documents: semanticColors.alert.border,
  awaiting_control: semanticColors.info.text,
  under_reserve: semanticColors.danger.border,
  accepted: semanticColors.progress.fill,
};

/** Jalon mis en avant par défaut : celui qui attend une action du
 * constructeur (réserve, pièce manquante), sinon le contrôle en cours,
 * sinon le prochain à déclarer. */
export function focusMilestone(milestones: LotMilestone[]): LotMilestone | undefined {
  const lastDeclared = Math.max(0, ...milestones.filter((m) => m.status !== 'not_declared').map((m) => m.order));
  return milestones.find((m) => m.status === 'under_reserve' && !m.correction_submitted)
    ?? milestones.find((m) => m.status === 'awaiting_documents')
    ?? milestones.find((m) => m.status === 'awaiting_control')
    ?? milestones.find((m) => m.status === 'not_declared' && m.order > lastDeclared)
    ?? milestones.find((m) => m.status === 'not_declared')
    ?? milestones[0];
}

/** Niveau de confiance du jalon, du plus faible au plus fort. */
function ProgressStrip({
  milestones, selectedId, onSelect,
}: { milestones: LotMilestone[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <Card aria-label="Avancement du lot">
      <ol
        style={{
          listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px',
        }}
      >
        {milestones.map((milestone) => {
          const selected = milestone.id === selectedId;
          return (
            <li key={milestone.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(milestone.id)}
                className="keya-tab"
                style={{
                  width: '100%', display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', border: 'none',
                  borderRadius: '6px', textAlign: 'left', font: 'inherit', color: 'inherit',
                  background: selected ? semanticColors.neutral.subtle : 'transparent',
                  outline: selected ? `2px solid ${semanticColors.neutral.heading}` : undefined,
                }}
              >
                <span aria-hidden="true" style={{ height: '8px', borderRadius: '4px', background: STATUS_BAR[milestone.status] }} />
                <span style={{ fontWeight: 700 }}>{milestone.label}</span>
                <span data-testid={`milestone-status-${milestone.code}`} style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>
                  {milestone.status_label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function MilestoneDetail({ milestone, onChanged }: { milestone: LotMilestone; onChanged: () => void }) {
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
    <section
      aria-label={`Jalon ${milestone.label}`}
      style={{
        background: semanticColors.neutral.surface,
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '6px',
        padding: 'clamp(18px, 3vw, 28px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '26px' }}>{`${milestone.order}. ${milestone.label}`}</h2>
        <Pill tone={milestoneTone(milestone)}>{milestone.status_label}</Pill>
        {milestone.control_scheduled && <Pill tone="info">Contrôleur affecté</Pill>}
      </div>
      {milestone.status_hint && (
        <p data-testid="milestone-status-hint" style={{ margin: '-8px 0 0', color: semanticColors.neutral.textMuted }}>
          {milestone.status_hint}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* PO-2026-09-28-04 : échelle des niveaux, chacun avec sa preuve
            (qui, rôle, quand, version examinée, périmètre) fournie par le
            serveur ; un niveau non atteint reste visible et vide. */}
        <h3 style={{ margin: 0, fontSize: '15px' }}>Niveaux de confiance</h3>
        <TrustLevels reached={milestone.trust_levels ?? {}} aria-label={`Niveaux de confiance — ${milestone.label}`} />
      </div>

      {milestone.status === 'not_declared' && (
        <div>
          <p style={{ margin: '0 0 10px' }}>Déclarez ce jalon dès que les travaux sont terminés, puis joignez au moins une pièce.</p>
          <Button type="button" variant="accent" onClick={() => { void declare(); }} disabled={declaring}>
            {declaring ? 'Déclaration…' : 'Déclarer ce jalon'}
          </Button>
        </div>
      )}
      {milestone.status === 'awaiting_documents' && (
        <>
          <p style={{ margin: 0 }}>Joignez au moins une pièce : une déclaration sans pièce n&apos;est pas contrôlée.</p>
          <FileAction label={`Pièce pour ${milestone.label}`} submitLabel="Joindre la pièce" onSubmit={addEvidence} />
        </>
      )}
      {milestone.status === 'awaiting_control' && (
        <>
          <p style={{ margin: 0 }}>
            {milestone.control_scheduled
              ? 'Un contrôleur est affecté à ce jalon.'
              : 'En attente de l’affectation d’un contrôleur.'}
          </p>
          <FileAction label={`Pièce pour ${milestone.label}`} submitLabel="Ajouter une pièce" onSubmit={addEvidence} />
        </>
      )}
      {milestone.status === 'under_reserve' && (
        milestone.correction_submitted ? (
          <p style={{ margin: 0 }}>Correction proposée : en attente du recontrôle (seul le contrôleur lève la réserve).</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>Réserve ouverte : proposez une correction avec une nouvelle pièce.</p>
            <FileAction
              label={`Correction pour ${milestone.label}`}
              submitLabel="Proposer la correction"
              onSubmit={proposeCorrection}
            />
          </>
        )
      )}
      {milestone.status === 'accepted' && (
        <p style={{ margin: 0 }}>Validé techniquement — démonstration (avis conforme, aucune réserve ouverte).</p>
      )}
      {error && <AlertBanner title={error} />}
      <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
        {CONTROLLER_DESIGNATION}
        {' '}
        Seul le contrôleur lève une réserve ; ajouter une pièce après l&apos;avis relance une revue.
      </p>
    </section>
  );
}

function LotMilestones({ lotId }: { lotId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.listLotMilestones(lotId), [lotId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (state.status === 'loading') return <p>Chargement des jalons…</p>;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger les jalons." onRetry={state.refetch} />;
  }
  if (state.data.length === 0) return <p>Aucun jalon pour ce lot.</p>;
  const milestones = [...state.data].sort((a, b) => a.order - b.order);
  const selected = milestones.find((milestone) => milestone.id === selectedId) ?? focusMilestone(milestones)!;
  const nextToDeclare = milestones.find(
    (milestone) => milestone.status === 'not_declared' && milestone.order > selected.order,
  );
  const accepted = milestones.filter((milestone) => milestone.status === 'accepted').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ProgressStrip milestones={milestones} selectedId={selected.id} onSelect={setSelectedId} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0 }}>
          <MilestoneDetail
            key={`${selected.id}-${selected.status}-${selected.evidence_count}-${selected.correction_submitted}`}
            milestone={selected}
            onChanged={state.refetch}
          />
        </div>
        <aside style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Card title="Avancement" icon="check-circle" tone="accent">
            <p style={{ margin: 0 }}>
              <strong style={{ fontSize: '22px' }}>{`${accepted} / ${milestones.length}`}</strong>
              {' jalons acceptés techniquement'}
            </p>
          </Card>
          {nextToDeclare && (
            <Card title="Prochain jalon à déclarer" icon="clipboard-check">
              <p style={{ margin: '0 0 12px' }}>
                {`${nextToDeclare.label} — déclarez-le dès que les travaux sont terminés, avec au moins une pièce.`}
              </p>
              <Button type="button" variant="secondary" onClick={() => setSelectedId(nextToDeclare.id)}>
                {`Ouvrir « ${nextToDeclare.label} »`}
              </Button>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

export function MilestonesView({ activeOrganizationId }: { activeOrganizationId: string | null }) {
  const api = useApiClient();
  const lotsState = useApiResource(
    () => api.getAllLots({ page_size: 100 }),
    [activeOrganizationId],
  );
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

  const lots = lotsState.status === 'success' ? lotsState.data.results : [];
  const lotId = selectedLotId && lots.some((lot) => lot.id === selectedLotId) ? selectedLotId : lots[0]?.id;
  const lot = lots.find((candidate) => candidate.id === lotId);

  return (
    <section aria-label="Jalons">
      <PageHeader
        eyebrow={lot ? lot.program_name : 'Chantier'}
        title={lot ? `${lot.name} — suivi des jalons` : 'Chantiers & jalons'}
        actions={lots.length > 0 && lotId ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600 }}>
            Lot
            <Select
              aria-label="Choisir un lot"
              value={lotId}
              onChange={(event) => setSelectedLotId(event.target.value)}
              style={{ minWidth: '280px' }}
            >
              {lots.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{`${candidate.program_name} — ${candidate.name}`}</option>
              ))}
            </Select>
          </label>
        ) : undefined}
      />
      {lotsState.status === 'loading' && <p>Chargement…</p>}
      {lotsState.status === 'error' && (
        <ApiErrorBanner error={lotsState.error} title="Impossible de charger vos lots." onRetry={lotsState.refetch} />
      )}
      {lotsState.status === 'success' && lots.length === 0 && (
        <p data-testid="no-lots">Aucun lot dans cette organisation.</p>
      )}
      {lotId && <LotMilestones key={lotId} lotId={lotId} />}
    </section>
  );
}
