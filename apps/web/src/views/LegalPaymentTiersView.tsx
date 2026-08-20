import { type FormEvent, useState } from 'react';

import { AlertBanner, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { LegalPaymentTierStep, LegalPaymentTierTemplate } from '../api/types';
import { type ResourceState, useApiResource } from '../api/useApiResource';
import { CountryPackSelector } from '../components/CountryPackSelector';

/**
 * Ticket F-030 — écran fonctionnel réel d'administration des paliers légaux
 * de paiement, périmètre admin_keyimmo : consultation du template actif
 * par pays, historique complet, création d'un nouveau template (brouillon)
 * avec ses paliers, activation. Connecté à `apps/pricing`
 * (`LegalPaymentTierTemplate`, ticket B-027) — jamais consommé côté
 * frontend jusqu'ici. Contrat API vérifié directement dans
 * `backend/apps/pricing/{views,serializers,services}.py` avant d'écrire ce
 * fichier.
 *
 * **Aucun sélecteur de pays** (`CountryPackSelector`, `apps/web/src/
 * components/`) : même trou et même solution temporaire que `PricingView`
 * (ticket F-028) — saisie manuelle d'UUID, explicitement documentée comme
 * en attente d'un futur ticket backend de recherche `CountryPack`.
 *
 * **`activated_by`/`activated_at` signifient « a été activé un jour », PAS
 * « est l'actif COURANT »** (voir `apps/web/src/api/types.ts::
 * LegalPaymentTierTemplate`) : `ActiveTemplatePanel`/`HistoryPanel`
 * reçoivent tous deux `activeTemplateId`, dérivé UNE SEULE FOIS par
 * `GET .../active/` au niveau de `LegalPaymentTierWorkspace` — jamais
 * recalculé en triant l'historique sur `activated_at`, qui serait faux
 * (un ancien actif superseded garde son `activated_at`, jamais effacé).
 */

function TemplateStepsTable({ steps }: { steps: LegalPaymentTierStep[] }) {
  if (steps.length === 0) {
    return <p>Aucun palier.</p>;
  }

  return (
    <table style={{ borderCollapse: 'collapse', fontSize: '14px', marginTop: '8px' }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
          <th style={{ padding: '4px 8px' }}>Ordre</th>
          <th style={{ padding: '4px 8px' }}>Code</th>
          <th style={{ padding: '4px 8px' }}>Libellé</th>
          <th style={{ padding: '4px 8px' }}>Plafond cumulé</th>
          <th style={{ padding: '4px 8px' }}>Paiements progressifs</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.id}>
            <td style={{ padding: '4px 8px' }}>{step.order}</td>
            <td style={{ padding: '4px 8px' }}>{step.code}</td>
            <td style={{ padding: '4px 8px' }}>{step.label}</td>
            <td style={{ padding: '4px 8px' }}>{step.cumulative_cap_percent} %</td>
            <td style={{ padding: '4px 8px' }}>{step.allows_progressive_payments ? 'Oui' : 'Non'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActiveTemplatePanel({ state }: { state: ResourceState<LegalPaymentTierTemplate | null> }) {
  return (
    <section aria-label="Template actif">
      <h3>Template actif</h3>
      {state.status === 'loading' && <p>Chargement du template actif…</p>}
      {state.status === 'error' && <AlertBanner title="Impossible de charger le template actif." />}
      {state.status === 'success' && (
        state.data === null ? (
          <p data-testid="no-active-template">Aucun template actif pour ce pays.</p>
        ) : (
          <div data-testid="active-template">
            <p>
              Version <strong>{state.data.version}</strong> — activé par {state.data.activated_by} le {state.data.activated_at}
            </p>
            <TemplateStepsTable steps={state.data.steps} />
          </div>
        )
      )}
    </section>
  );
}

function ActivateButton({ template, onActivated }: { template: LegalPaymentTierTemplate; onActivated: () => void }) {
  const api = useApiClient();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleActivate() {
    setActivating(true);
    setError(null);
    try {
      await api.activateLegalPaymentTierTemplate(template.id);
      onActivated();
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, "Échec de l'activation."));
    } finally {
      setActivating(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={() => { void handleActivate(); }} disabled={activating}>
        {activating ? 'Activation…' : 'Activer'}
      </button>
      {error && <AlertBanner title={error} />}
    </div>
  );
}

function HistoryPanel({
  countryPackId, activeTemplateId, reloadKey, onChanged,
}: { countryPackId: string; activeTemplateId: string | null; reloadKey: number; onChanged: () => void }) {
  const api = useApiClient();
  const state = useApiResource(
    () => api.getLegalPaymentTierTemplateHistory(countryPackId),
    [countryPackId, reloadKey],
  );

  return (
    <section aria-label="Historique des templates" style={{ marginTop: '16px' }}>
      <h3>Historique</h3>
      {state.status === 'loading' && <p>Chargement de l&apos;historique…</p>}
      {state.status === 'error' && <AlertBanner title="Impossible de charger l'historique." />}
      {state.status === 'success' && (
        state.data.length === 0 ? (
          <p data-testid="no-template-history">Aucun template enregistré pour l&apos;instant.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}`, textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>Version</th>
                <th style={{ padding: '10px 12px' }}>Créé par</th>
                <th style={{ padding: '10px 12px' }}>Créé le</th>
                <th style={{ padding: '10px 12px' }}>Activé par</th>
                <th style={{ padding: '10px 12px' }}>Activé le</th>
                <th style={{ padding: '10px 12px' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((template) => (
                <tr key={template.id} style={{ borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
                  <td style={{ padding: '10px 12px' }}>{template.version}</td>
                  <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{template.created_by}</td>
                  <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{template.created_at}</td>
                  <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{template.activated_by ?? '—'}</td>
                  <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{template.activated_at ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {template.id === activeTemplateId ? (
                      <span data-testid="template-active-badge">Actif</span>
                    ) : (
                      <ActivateButton template={template} onActivated={onChanged} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </section>
  );
}

interface StepFormRow {
  order: string;
  code: string;
  label: string;
  cumulative_cap_percent: string;
  allows_progressive_payments: boolean;
}

function blankStepRow(order: number): StepFormRow {
  return {
    order: String(order), code: '', label: '', cumulative_cap_percent: '', allows_progressive_payments: false,
  };
}

function CreateTemplateForm({ countryPackId, onCreated }: { countryPackId: string; onCreated: () => void }) {
  const api = useApiClient();
  const [version, setVersion] = useState('');
  const [steps, setSteps] = useState<StepFormRow[]>([blankStepRow(1)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStep(index: number, patch: Partial<StepFormRow>) {
    setSteps((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addStep() {
    setSteps((current) => [...current, blankStepRow(current.length + 1)]);
  }

  function removeStep(index: number) {
    setSteps((current) => current.filter((_row, rowIndex) => rowIndex !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createLegalPaymentTierTemplate({
        country_pack: countryPackId,
        version: Number(version),
        steps: steps.map((row) => ({
          order: Number(row.order),
          code: row.code.trim(),
          label: row.label.trim(),
          cumulative_cap_percent: row.cumulative_cap_percent.trim(),
          allows_progressive_payments: row.allows_progressive_payments,
        })),
      });
      setVersion('');
      setSteps([blankStepRow(1)]);
      onCreated();
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, 'Échec de la création du template.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label="Créer un nouveau template"
      style={{ marginTop: '16px' }}
    >
      <label>
        Version
        <input
          type="text"
          inputMode="numeric"
          aria-label="Version"
          value={version}
          onChange={(event) => setVersion(event.target.value)}
          required
          style={{ display: 'block', marginTop: '4px', width: '100px' }}
        />
      </label>

      <table style={{ borderCollapse: 'collapse', marginTop: '12px', fontSize: '14px' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={{ padding: '4px' }}>Ordre</th>
            <th style={{ padding: '4px' }}>Code</th>
            <th style={{ padding: '4px' }}>Libellé</th>
            <th style={{ padding: '4px' }}>Plafond cumulé (%)</th>
            <th style={{ padding: '4px' }}>Paiements progressifs</th>
            <th style={{ padding: '4px' }} />
          </tr>
        </thead>
        <tbody>
          {steps.map((row, index) => (
            // eslint-disable-next-line react/no-array-index-key -- lignes de formulaire sans id stable, l'ordre est l'identité voulue ici
            <tr key={index}>
              <td style={{ padding: '4px' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Ordre du palier ${index + 1}`}
                  value={row.order}
                  onChange={(event) => updateStep(index, { order: event.target.value })}
                  style={{ width: '48px' }}
                />
              </td>
              <td style={{ padding: '4px' }}>
                <input
                  type="text"
                  aria-label={`Code du palier ${index + 1}`}
                  value={row.code}
                  onChange={(event) => updateStep(index, { code: event.target.value })}
                  style={{ width: '100px' }}
                />
              </td>
              <td style={{ padding: '4px' }}>
                <input
                  type="text"
                  aria-label={`Libellé du palier ${index + 1}`}
                  value={row.label}
                  onChange={(event) => updateStep(index, { label: event.target.value })}
                  style={{ width: '160px' }}
                />
              </td>
              <td style={{ padding: '4px' }}>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Plafond cumulé du palier ${index + 1}`}
                  value={row.cumulative_cap_percent}
                  onChange={(event) => updateStep(index, { cumulative_cap_percent: event.target.value })}
                  style={{ width: '80px' }}
                />
              </td>
              <td style={{ padding: '4px' }}>
                <input
                  type="checkbox"
                  aria-label={`Paiements progressifs du palier ${index + 1}`}
                  checked={row.allows_progressive_payments}
                  onChange={(event) => updateStep(index, { allows_progressive_payments: event.target.checked })}
                />
              </td>
              <td style={{ padding: '4px' }}>
                <button type="button" onClick={() => removeStep(index)} disabled={steps.length <= 1}>
                  Retirer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" onClick={addStep} style={{ marginTop: '8px' }}>Ajouter un palier</button>

      <div style={{ marginTop: '12px' }}>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Enregistrement…' : 'Créer ce template'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: '8px' }}>
          <AlertBanner title={error} />
        </div>
      )}
    </form>
  );
}

function LegalPaymentTierWorkspace({ countryPackId }: { countryPackId: string }) {
  const api = useApiClient();
  const [reloadKey, setReloadKey] = useState(0);
  const activeState = useApiResource(
    () => api.getActiveLegalPaymentTierTemplate(countryPackId),
    [countryPackId, reloadKey],
  );

  function handleChanged() {
    setReloadKey((key) => key + 1);
  }

  const activeTemplateId = activeState.status === 'success' && activeState.data ? activeState.data.id : null;

  return (
    <>
      <ActiveTemplatePanel state={activeState} />
      <HistoryPanel
        countryPackId={countryPackId}
        activeTemplateId={activeTemplateId}
        reloadKey={reloadKey}
        onChanged={handleChanged}
      />
      <h3 style={{ marginTop: '16px' }}>Créer un nouveau template</h3>
      <CreateTemplateForm countryPackId={countryPackId} onCreated={handleChanged} />
    </>
  );
}

export function LegalPaymentTiersView() {
  const [countryPackId, setCountryPackId] = useState<string | null>(null);

  return (
    <section aria-label="Paliers légaux de paiement">
      <h2>Paliers légaux de paiement par pays</h2>

      {countryPackId ? (
        <div style={{ marginBottom: '16px' }}>
          <p>
            Pays sélectionné : <strong>{countryPackId}</strong>{' '}
            <button type="button" onClick={() => setCountryPackId(null)}>Changer de pays</button>
          </p>
        </div>
      ) : (
        <CountryPackSelector onLoad={setCountryPackId} submitLabel="Charger les paliers de ce pays" />
      )}

      {countryPackId && <LegalPaymentTierWorkspace countryPackId={countryPackId} />}
    </section>
  );
}
