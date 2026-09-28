import { type FormEvent, useEffect, useState } from 'react';

import {
  AlertBanner, Button, Icon, Pill, TrustLevels, semanticColors, formatServerDateTime,
} from '@keya/design-system';

import type {
  ApiClient, MissionDetail, OpenReserve, OpinionPayload, OpinionResult,
} from '../api/client';

/**
 * Audit UI R1 — avis du contrôleur, EN LIGNE (K04, PO-2026-09-27-04 : la
 * date serveur fait foi).
 *
 * - K01 : « Pièces soumises » en tête (fichier, version, déposant, date) ;
 *   l'avis enregistre les versions examinées.
 * - K02 : réserves STRUCTURÉES (motif, action attendue), plusieurs possibles,
 *   date posée par le serveur ; commentaire APRÈS la décision.
 * - K03 : au recontrôle, décision EXPLICITE par réserve (Levée / Maintenue,
 *   avec motif) — jamais une levée implicite.
 *
 * Les règles sont appliquées par le serveur (CDC §7.1) ; ce formulaire les
 * reflète seulement pour guider la saisie.
 */


// Audit UI R1 (F06) : format de date unique, fuseau indiqué.
function formatServerDate(value: string) {
  return formatServerDateTime(value);
}

const sectionStyle = {
  display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px', borderRadius: '6px',
  border: `1px solid ${semanticColors.neutral.border}`, background: semanticColors.neutral.surface,
} as const;

const labelStyle = { display: 'flex', flexDirection: 'column', gap: '6px', fontWeight: 600, fontSize: '15px' } as const;

const fieldStyle = {
  minHeight: '44px', padding: '10px 12px', borderRadius: '6px', fontSize: '16px', fontFamily: 'inherit',
  border: `1px solid ${semanticColors.neutral.border}`, background: semanticColors.neutral.surface, color: semanticColors.neutral.text,
} as const;

interface NewReserve { motif: string; expectedAction: string }
type Decision = { decision: 'levee' | 'maintenue' | ''; motif: string };

/** Contrôles de saisie, mêmes règles que le serveur (CDC §7.1). */
export function opinionErrors(
  outcome: OpinionPayload['outcome'] | '', reserves: NewReserve[], openReserves: OpenReserve[], decisions: Record<string, Decision>,
  evidenceCount = 1,
): string[] {
  const errors: string[] = [];
  // PO-2026-09-28-13 (K01, CDC §7.2) : un avis porte sur au moins une pièce soumise.
  if (evidenceCount === 0) errors.push('Aucune pièce soumise : un avis porte sur au moins une version de pièce.');
  if (!outcome) errors.push('Choisissez un avis : conforme ou non conforme.');
  for (const reserve of openReserves) {
    const decision = decisions[reserve.id];
    if (!decision?.decision) errors.push(`Décidez de la réserve « ${reserve.motif} » : levée ou maintenue.`);
    else if (!decision.motif.trim()) errors.push(`Indiquez le motif de votre décision sur « ${reserve.motif} ».`);
  }
  const maintained = openReserves.some((reserve) => decisions[reserve.id]?.decision === 'maintenue');
  if (outcome === 'conforme' && maintained) errors.push('Un avis conforme exige la levée de chaque réserve ouverte.');
  if (outcome === 'conforme' && reserves.length > 0) errors.push('Un avis conforme n’ouvre aucune réserve.');
  if (outcome === 'avec_reserve' && reserves.length === 0 && !maintained) {
    errors.push('Un avis non conforme ouvre au moins une réserve (ou en maintient une).');
  }
  reserves.forEach((reserve, index) => {
    if (!reserve.motif.trim() || !reserve.expectedAction.trim()) {
      errors.push(`Réserve ${index + 1} : motif et action attendue sont obligatoires.`);
    }
  });
  return errors;
}

function ReserveDecisionField({
  reserve, value, onChange,
}: { reserve: OpenReserve; value: Decision; onChange: (next: Decision) => void }) {
  return (
    <fieldset data-testid="reserve-decision" style={{ ...sectionStyle, margin: 0 }}>
      <legend style={{ fontWeight: 700, padding: '0 4px' }}>{`Réserve : ${reserve.motif}`}</legend>
      <p style={{ margin: 0 }}>
        <strong>Action attendue :</strong>
        {' '}
        {reserve.expectedAction}
      </p>
      <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
        {`Ouverte le ${formatServerDate(reserve.openedAt)} · ${reserve.statusLabel}`}
      </p>
      {reserve.corrections.map((correction) => (
        <p key={correction.submittedAt} style={{ margin: 0, fontSize: '14px' }}>
          {`Correction proposée par ${correction.submittedBy} le ${formatServerDate(correction.submittedAt)}`}
        </p>
      ))}
      <div role="radiogroup" aria-label={`Décision sur la réserve « ${reserve.motif} »`} style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {(['levee', 'maintenue'] as const).map((option) => (
          <label key={option} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minHeight: '44px', fontWeight: 600 }}>
            <input
              type="radio"
              name={`decision-${reserve.id}`}
              checked={value.decision === option}
              onChange={() => onChange({ ...value, decision: option })}
              style={{ width: '20px', height: '20px' }}
            />
            {option === 'levee' ? 'Levée' : 'Maintenue'}
          </label>
        ))}
      </div>
      <label style={labelStyle}>
        Motif de la décision
        <textarea
          value={value.motif}
          onChange={(event) => onChange({ ...value, motif: event.target.value })}
          rows={2}
          style={fieldStyle}
        />
      </label>
    </fieldset>
  );
}

export interface MissionReviewViewProps {
  missionId: string;
  api: Pick<ApiClient, 'getMissionDetail' | 'submitOpinion' | 'fetchDocument'>;
  onBack: () => void;
}

export function documentLabel(fileName: string, index: number): string {
  const extension = fileName.includes('.') ? fileName.split('.').pop()!.toUpperCase() : '';
  return extension ? `Pièce ${index + 1} (${extension})` : `Pièce ${index + 1}`;
}

export function MissionReviewView({ missionId, api, onBack }: MissionReviewViewProps) {
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OpinionPayload['outcome'] | ''>('');
  const [reserves, setReserves] = useState<NewReserve[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OpinionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getMissionDetail(missionId)
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch(() => { if (!cancelled) setLoadError('Impossible de charger la mission. Vérifiez votre connexion et réessayez.'); });
    return () => { cancelled = true; };
  }, [api, missionId]);

  async function openDocument(documentId: string) {
    try {
      const blob = await api.fetchDocument(missionId, documentId);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch {
      setErrors(['Cette pièce est indisponible pour le moment.']);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const found = opinionErrors(outcome, reserves, detail.openReserves, decisions, detail.evidences.length);
    setErrors(found);
    if (found.length > 0 || !outcome) return;
    setSubmitting(true);
    try {
      const saved = await api.submitOpinion(missionId, {
        outcome,
        examinedEvidenceIds: detail.evidences.map((evidence) => evidence.id),
        reserves: outcome === 'avec_reserve' ? reserves : [],
        decisions: detail.openReserves.map((reserve) => ({
          reserveId: reserve.id,
          decision: decisions[reserve.id].decision as 'levee' | 'maintenue',
          motif: decisions[reserve.id].motif.trim(),
        })),
        note: note.trim(),
      });
      setResult(saved);
    } catch (caught) {
      setErrors([caught instanceof Error ? caught.message : 'L’avis n’a pas été enregistré.']);
    } finally {
      setSubmitting(false);
    }
  }

  const backButton = (
    <Button type="button" variant="secondary" onClick={onBack} style={{ minHeight: '44px', alignSelf: 'flex-start' }}>
      ← Mes missions
    </Button>
  );

  if (loadError) return <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>{backButton}<AlertBanner title={loadError} /></section>;
  if (!detail) return <section>{backButton}<p>Chargement de la mission…</p></section>;

  if (result) {
    return (
      <section aria-label="Avis enregistré" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p role="status" style={{ margin: 0, fontWeight: 700 }}>
          {`Avis enregistré — horodatage serveur : ${formatServerDate(result.recordedAt)}.`}
        </p>
        {backButton}
      </section>
    );
  }

  if (detail.completed) {
    return (
      <section aria-label={`Mission — ${detail.lotName}`} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {backButton}
        <p role="status" style={{ margin: 0 }}>Votre avis sur cette mission est déjà enregistré.</p>
      </section>
    );
  }

  return (
    <section aria-label={`Mission — ${detail.lotName}`} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {backButton}
      <header style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <h1 style={{ margin: 0, fontSize: '22px' }}>{`${detail.lotName} — ${detail.milestoneLabel}`}</h1>
        <span style={{ color: semanticColors.neutral.textMuted }}>{`${detail.programName} · ${detail.assetName}`}</span>
        <span>{detail.followUp ? <Pill tone="alert">Recontrôle</Pill> : <Pill tone="primary">Première inspection</Pill>}</span>
      </header>

      {/* PO-2026-09-28-04 : niveaux déjà atteints par ce jalon, chacun avec
          sa preuve (qui, rôle, quand, version examinée, périmètre). */}
      <section aria-labelledby="levels-title" style={sectionStyle}>
        <h2 id="levels-title" style={{ margin: 0, fontSize: '18px' }}>Niveaux de confiance du jalon</h2>
        <TrustLevels reached={detail.trustLevels ?? {}} aria-label={`Niveaux de confiance — ${detail.milestoneLabel}`} />
      </section>

      <section aria-labelledby="submitted-title" style={sectionStyle}>
        <h2 id="submitted-title" style={{ margin: 0, fontSize: '18px' }}>Pièces soumises</h2>
        <p style={{ margin: 0 }}>
          {`Déclaration : ${detail.declaration.declaredBy}, le ${formatServerDate(detail.declaration.declaredAt)}.`}
          {detail.declaration.note && ` « ${detail.declaration.note} »`}
        </p>
        {detail.evidences.length === 0 && (
          <p style={{ margin: 0 }}>Aucune pièce soumise : l’avis ne peut pas être enregistré tant que le constructeur n’a pas déposé de pièce.</p>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {detail.evidences.map((evidence) => (
            <li key={evidence.id} data-testid="submitted-evidence" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <strong>{`Version ${evidence.version} — déposée par ${evidence.addedBy}, le ${formatServerDate(evidence.addedAt)}`}</strong>
              {evidence.documents.map((document, index) => (
                <span key={document.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <Icon name="file-text" size={16} />
                  {/* Le nom d'origine n'est pas conservé au dépôt (fichier renommé côté serveur) :
                      libellé lisible plutôt qu'un identifiant technique. */}
                  <span style={{ overflowWrap: 'anywhere' }}>{documentLabel(document.fileName, index)}</span>
                  <code style={{ fontSize: '12px', color: semanticColors.neutral.textMuted }}>{`#${document.sha256.slice(0, 8)}`}</code>
                  <Button type="button" variant="secondary" onClick={() => { void openDocument(document.id); }} style={{ minHeight: '44px' }}>
                    Consulter
                  </Button>
                </span>
              ))}
            </li>
          ))}
        </ul>
        <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
          Votre avis sera lié à ces versions ; une pièce ajoutée ensuite demandera une nouvelle revue.
        </p>
      </section>

      <form onSubmit={(event) => { void handleSubmit(event); }} aria-label="Avis du contrôleur" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {detail.openReserves.length > 0 && (
          <section aria-labelledby="decisions-title" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h2 id="decisions-title" style={{ margin: 0, fontSize: '18px' }}>Réserves à trancher</h2>
            {detail.openReserves.map((reserve) => (
              <ReserveDecisionField
                key={reserve.id}
                reserve={reserve}
                value={decisions[reserve.id] ?? { decision: '', motif: '' }}
                onChange={(next) => setDecisions((current) => ({ ...current, [reserve.id]: next }))}
              />
            ))}
          </section>
        )}

        <fieldset style={{ ...sectionStyle, margin: 0 }}>
          <legend style={{ fontWeight: 700, padding: '0 4px' }}>Votre avis</legend>
          {([
            ['conforme', 'Conforme'],
            ['avec_reserve', 'Non conforme — réserve(s)'],
          ] as const).map(([value, label]) => (
            <label key={value} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minHeight: '44px', fontWeight: 600 }}>
              <input
                type="radio"
                name="outcome"
                checked={outcome === value}
                onChange={() => {
                  setOutcome(value);
                  if (value === 'avec_reserve' && reserves.length === 0) setReserves([{ motif: '', expectedAction: '' }]);
                  if (value === 'conforme') setReserves([]);
                }}
                style={{ width: '20px', height: '20px' }}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {outcome === 'avec_reserve' && (
          <section aria-labelledby="new-reserves-title" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h2 id="new-reserves-title" style={{ margin: 0, fontSize: '18px' }}>Réserves ouvertes par cet avis</h2>
            {reserves.map((reserve, index) => (
              <fieldset key={index} data-testid="new-reserve" style={{ ...sectionStyle, margin: 0 }}>
                <legend style={{ fontWeight: 700, padding: '0 4px' }}>{`Réserve ${index + 1}`}</legend>
                <label style={labelStyle}>
                  Motif
                  <input
                    value={reserve.motif}
                    onChange={(event) => setReserves((current) => current.map((item, i) => (i === index ? { ...item, motif: event.target.value } : item)))}
                    style={fieldStyle}
                  />
                </label>
                <label style={labelStyle}>
                  Action attendue du constructeur
                  <textarea
                    value={reserve.expectedAction}
                    onChange={(event) => setReserves((current) => current.map((item, i) => (i === index ? { ...item, expectedAction: event.target.value } : item)))}
                    rows={2}
                    style={fieldStyle}
                  />
                </label>
                {reserves.length > 1 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setReserves((current) => current.filter((_, i) => i !== index))}
                    style={{ minHeight: '44px', alignSelf: 'flex-start' }}
                  >
                    Retirer cette réserve
                  </Button>
                )}
              </fieldset>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReserves((current) => [...current, { motif: '', expectedAction: '' }])}
              style={{ minHeight: '44px', alignSelf: 'flex-start' }}
            >
              Ajouter une réserve
            </Button>
            <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
              La date de chaque réserve est posée par le serveur à l’enregistrement.
            </p>
          </section>
        )}

        <label style={labelStyle}>
          Commentaire (facultatif)
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} style={fieldStyle} />
        </label>

        {errors.length > 0 && (
          <AlertBanner title="L’avis ne peut pas encore être enregistré">
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </AlertBanner>
        )}

        <Button type="submit" variant="accent" disabled={submitting} style={{ minHeight: '48px' }}>
          {submitting ? 'Enregistrement…' : 'Enregistrer l’avis'}
        </Button>
      </form>
    </section>
  );
}
