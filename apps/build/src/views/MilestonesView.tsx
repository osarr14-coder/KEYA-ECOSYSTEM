import { type FormEvent, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Icon, CONTROLLER_DESIGNATION, Card, MilestoneGauge, MilestoneGaugeLegend, PageHeader,
  Pill, type PillTone, ReserveCard, type ReserveState, Select, TrustLevels, formatCalendarDate, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { LotMilestone, MilestoneReserve, RequiredPiece } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-069 — jalons d'un lot côté constructeur (backend B-054, CDC V3
 * §7.1) : déclarer, joindre des pièces, proposer une correction sur une
 * réserve. Le constructeur ne lève jamais une réserve et un dépôt n'accepte
 * jamais les travaux : l'état affiché est dérivé par le serveur (contrôle,
 * réserve, acceptation), jamais décidé ici.
 */

/** Vérification finale (T15, T20) : le message du SERVEUR (format refusé,
 * fichier trop volumineux, pièce non exigée…), jamais « Échec de la requête
 * /api/documents/ (400) ». */
function errorMessage(caught: unknown, fallback: string) {
  if (caught instanceof ApiError) {
    if (caught.detail) return caught.detail;
    if (caught.body && typeof caught.body === 'object') {
      const messages = Object.values(caught.body as Record<string, unknown>)
        .flat()
        .filter((value): value is string => typeof value === 'string');
      if (messages.length > 0) return messages.join(' ');
    }
    return fallback;
  }
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

const OTHER_PIECE = '';

function FileAction({
  label, submitLabel, onSubmit, pieces = [],
}: {
  label: string; submitLabel: string; onSubmit: (file: File, requiredPiece: string) => Promise<void>;
  /** PO-2026-09-28-63 : le constructeur dit à quelle pièce exigée répond le fichier. */
  pieces?: RequiredPiece[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [requiredPiece, setRequiredPiece] = useState<string>(
    () => pieces.find((piece) => !piece.deposited)?.code ?? OTHER_PIECE,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(file, requiredPiece);
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
      {pieces.length > 0 && (
        <Select
          aria-label={`Pièce exigée — ${label}`}
          value={requiredPiece}
          onChange={(event) => setRequiredPiece(event.target.value)}
          style={{ width: 'auto', maxWidth: '100%', minHeight: '44px' }}
        >
          {pieces.map((piece) => (
            <option key={piece.code} value={piece.code}>
              {piece.deposited ? `${piece.label} (déjà déposée)` : piece.label}
            </option>
          ))}
          <option value={OTHER_PIECE}>Autre pièce</option>
        </Select>
      )}
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

const RESERVE_STATE: Record<string, ReserveState> = {
  ouverte: 'open', correction_proposee: 'correction_proposed', nouvelle_inspection: 'recheck', maintenue: 'maintained',
};

/** PO-2026-09-28-16 : chaque réserve ouverte du jalon — motif, action
 * attendue, date serveur et auteur (« organisation · rôle ») — au-dessus du
 * formulaire de correction. */
function OpenReserves({ reserves }: { reserves: MilestoneReserve[] }) {
  if (reserves.length === 0) return null;
  return (
    <section aria-label="Réserves ouvertes du jalon" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h3 style={{ margin: 0, fontSize: '15px' }}>
        {reserves.length > 1 ? `Réserves ouvertes (${reserves.length})` : 'Réserve ouverte'}
      </h3>
      {reserves.map((reserve, index) => (
        <ReserveCard
          key={reserve.id}
          state={RESERVE_STATE[reserve.status ?? ''] ?? 'open'}
          stateLabel={reserve.status_label || undefined}
          title={reserves.length > 1 ? `Réserve ${index + 1}` : 'Réserve du contrôleur'}
          openedAt={reserve.opened_at}
          openedBy={reserve.opened_by}
          reason={reserve.motif}
          expectedAction={reserve.expected_action || 'Non précisée'}
          proposedCorrection={reserve.status === 'correction_proposee' ? 'Correction proposée — en attente du recontrôle' : undefined}
        />
      ))}
    </section>
  );
}

const STATUS_TONE: Record<LotMilestone['status'], PillTone> = {
  not_declared: 'neutral',
  awaiting_documents: 'alert',
  awaiting_control: 'info',
  // PO-2026-09-28-17 : « Corrections demandées » = action attendue (Attention) ;
  // le rouge est réservé aux erreurs et aux refus.
  under_reserve: 'alert',
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

/** PO-2026-09-28-27 : carte du lot — compteur « n / N » en texte, jauge
 * segmentée (un bouton par jalon, état CDC du serveur), légende. Le jalon
 * sélectionné s'ouvre juste en dessous. */
function LotGaugeCard({
  milestones, selectedId, onSelect,
}: { milestones: LotMilestone[]; selectedId: string; onSelect: (id: string) => void }) {
  const accepted = milestones.filter((milestone) => milestone.cdc_state === 'TECHNICALLY_ACCEPTED').length;
  return (
    <Card aria-label="Jauge des jalons">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '17px' }}>Jalons du chantier</h2>
        <p data-testid="accepted-count" style={{ margin: 0, textAlign: 'right' }}>
          <strong style={{ fontSize: '26px', color: semanticColors.neutral.heading }}>{accepted}</strong>
          <span style={{ fontSize: '17px', color: semanticColors.neutral.textMuted }}>{` / ${milestones.length}`}</span>
          <span style={{ display: 'block', fontSize: '12px', color: semanticColors.neutral.textMuted }}>jalons acceptés techniquement</span>
        </p>
      </div>
      <MilestoneGauge
        milestones={milestones.map((milestone) => ({
          id: milestone.id,
          code: milestone.code,
          label: milestone.label,
          cdcState: milestone.cdc_state ?? '',
          statusLabel: milestone.status_label,
          openReserveCount: (milestone.open_reserves ?? []).length,
          meta: (milestone.open_reserves ?? []).length > 0
            ? `${(milestone.open_reserves ?? []).length} réserve${(milestone.open_reserves ?? []).length > 1 ? 's' : ''} ouverte${(milestone.open_reserves ?? []).length > 1 ? 's' : ''} depuis le ${formatCalendarDate((milestone.open_reserves ?? [])[0].opened_at)}`
            : milestone.status_hint || undefined,
        }))}
        selectedId={selectedId}
        onSelect={onSelect}
        aria-label="Jalons du lot"
      />
      <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: `1px solid ${semanticColors.neutral.border}` }}>
        <MilestoneGaugeLegend />
      </div>
    </Card>
  );
}

/** PO-2026-09-28-63/-64 — pièces exigées du jalon et leur PRÉSENCE
 * (« Déposée » / « À déposer ») ; la conformité reste l'affaire du
 * contrôleur. */
function RequiredPieces({ pieces, declared }: { pieces: RequiredPiece[]; declared: boolean }) {
  const deposited = pieces.filter((piece) => piece.deposited).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="required-pieces">
      <h3 style={{ margin: 0, fontSize: '15px' }}>
        {declared ? `Pièces exigées — ${deposited} / ${pieces.length} déposées` : 'Pièces exigées pour ce jalon'}
      </h3>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {pieces.map((piece) => (
          <li
            key={piece.code}
            style={declared
              ? { display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', gap: '8px', alignItems: 'baseline' }
              : undefined}
          >
            {declared && (
              <span><Pill tone={piece.deposited ? 'info' : 'alert'}>{piece.deposited ? 'Déposée' : 'À déposer'}</Pill></span>
            )}
            <span>{piece.label}</span>
          </li>
        ))}
      </ul>
      {declared && (
        <p style={{ margin: 0, fontSize: '13px', color: semanticColors.neutral.textMuted }}>
          « Déposée » veut dire jointe, pas conforme : seul le contrôleur l’examine.
        </p>
      )}
    </div>
  );
}

/** PO-2026-09-28-60 (P20) et PO-2026-09-28-44 (P30) : après une action, le
 * constructeur reste sur le jalon et lit ce qui a changé et qui agit
 * ensuite. */
const DONE_MESSAGES = {
  declared: 'Jalon déclaré — joignez au moins une pièce pour le soumettre au contrôle.',
  submitted: 'Pièce jointe — jalon soumis : le gestionnaire affecte maintenant le contrôleur.',
  corrected: 'Correction proposée — en attente de recontrôle : le gestionnaire affecte le contrôleur, qui seul lève la réserve.',
} as const;
type DoneMessage = keyof typeof DONE_MESSAGES;

function MilestoneDetail({
  milestone, onChanged, notice,
}: { milestone: LotMilestone; onChanged: (done?: DoneMessage) => void; notice?: string | null }) {
  const api = useApiClient();
  const pieces = milestone.required_pieces ?? [];
  const [declaring, setDeclaring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function declare() {
    setDeclaring(true);
    setError(null);
    try {
      await api.declareMilestone(milestone.id);
      onChanged('declared');
    } catch (caught) {
      setError(errorMessage(caught, 'Échec de la déclaration.'));
      setDeclaring(false);
    }
  }

  async function addEvidence(file: File, requiredPiece: string) {
    await api.addEvidenceDocument({
      workDeclarationId: milestone.work_declaration_id as string,
      file,
      category: 'preuve_chantier',
      source: 'control_tower_upload',
      ...(requiredPiece ? { requiredPiece } : {}),
    });
    onChanged(milestone.status === 'awaiting_documents' ? 'submitted' : undefined);
  }

  async function proposeCorrection(file: File, requiredPiece: string) {
    const { evidenceId } = await api.addEvidenceDocument({
      workDeclarationId: milestone.work_declaration_id as string,
      file,
      category: 'preuve_chantier',
      source: 'control_tower_upload',
      ...(requiredPiece ? { requiredPiece } : {}),
    });
    await api.createReserveCorrection(milestone.reserve_id as string, evidenceId);
    onChanged('corrected');
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
      {notice && (
        <p role="status" data-testid="milestone-done" style={{ margin: 0, fontWeight: 600 }}>{notice}</p>
      )}
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

      {pieces.length > 0 && <RequiredPieces pieces={pieces} declared={milestone.status !== 'not_declared'} />}
      {milestone.status === 'not_declared' && milestone.chantier_open === false && (
        // PO-2026-09-29-09 : pas de déclaration avant la concrétisation du
        // dossier ; le motif vient du serveur, qui refuse aussi la requête.
        <p data-testid="chantier-closed" style={{ margin: 0 }}>{milestone.chantier_hint}</p>
      )}
      {milestone.status === 'not_declared' && milestone.chantier_open !== false && (
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
          <FileAction label={`Pièce pour ${milestone.label}`} submitLabel="Joindre la pièce" onSubmit={addEvidence} pieces={pieces} />
        </>
      )}
      {milestone.status === 'awaiting_control' && (
        <>
          <p style={{ margin: 0 }}>
            {milestone.control_scheduled
              ? 'Un contrôleur est affecté à ce jalon.'
              : 'En attente de l’affectation d’un contrôleur.'}
          </p>
          <FileAction label={`Pièce pour ${milestone.label}`} submitLabel="Ajouter une pièce" onSubmit={addEvidence} pieces={pieces} />
        </>
      )}
      <OpenReserves reserves={milestone.open_reserves ?? []} />
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
              pieces={pieces}
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
  const [done, setDone] = useState<{ milestoneId: string; message: string } | null>(null);

  if (state.status === 'loading') return <p>Chargement des jalons…</p>;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger les jalons." onRetry={state.refetch} />;
  }
  if (state.data.length === 0) return <p>Aucun jalon pour ce lot.</p>;
  const milestones = [...state.data].sort((a, b) => a.order - b.order);
  const selected = milestones.find((milestone) => milestone.id === selectedId) ?? focusMilestone(milestones)!;
  // Même règle que la tâche du constructeur (PO-2026-09-28-44, P21) : le
  // jalon suivant n'est à déclarer qu'une fois les précédents acceptés.
  const nextToDeclare = milestones.find(
    (milestone) => milestone.status === 'not_declared' && milestone.order > selected.order
      && milestones.every((earlier) => earlier.order >= milestone.order || earlier.status === 'accepted'),
  );

  function changed(message?: DoneMessage) {
    // P20 : rester sur le jalon où l'action vient d'être faite.
    setSelectedId(selected.id);
    setDone(message ? { milestoneId: selected.id, message: DONE_MESSAGES[message] } : null);
    state.refetch();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <LotGaugeCard
        milestones={milestones}
        selectedId={selected.id}
        onSelect={(id) => { setSelectedId(id); setDone(null); }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0 }}>
          <MilestoneDetail
            key={`${selected.id}-${selected.status}-${selected.evidence_count}-${selected.correction_submitted}`}
            milestone={selected}
            onChanged={changed}
            notice={done?.milestoneId === selected.id ? done.message : null}
          />
        </div>
        <aside style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
