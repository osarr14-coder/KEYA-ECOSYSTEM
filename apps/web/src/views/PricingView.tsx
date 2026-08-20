import { type FormEvent, useState } from 'react';

import { AlertBanner, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { PricingCanal } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-028 — écran fonctionnel réel d'administration des tarifs,
 * périmètre admin_keyimmo : consultation des taux actifs par pays/canal,
 * historique complet, création d'un nouveau taux. Connecté à
 * `apps/pricing` (ticket 025-backend) — contrat API vérifié directement
 * dans `backend/apps/pricing/{views,serializers,services}.py` avant
 * d'écrire ce fichier.
 *
 * **Aucun sélecteur de pays** : contrairement à `DevisView.tsx` (ticket
 * B-028, Lot/Organisation), aucun endpoint ne liste les `CountryPack` —
 * `apps/organizations/urls.py` n'existe toujours pas, aucun serializer
 * existant n'expose `CountryPack`. Décision actée avec l'utilisateur :
 * documenter ce trou comme prérequis pour un futur ticket backend (même
 * modèle que B-028/B-011, recherche filtrée, jamais un dump complet — un
 * seul `CountryPack` existe aujourd'hui, mais la doctrine interdit de le
 * coder en dur, CLAUDE.md, section « Doctrine produit »), et fonctionner
 * en attendant avec une saisie manuelle d'UUID — même schéma temporaire que
 * `LotSelector` au tout premier passage du ticket F-027.
 *
 * `PricingCanal` (`canal_1_marge`/`canal_2_commission`) EST codé en dur ici
 * (`CANALS` ci-dessous) — à la différence de `CountryPack`, c'est un
 * vocabulaire de doctrine FIXE (comme `TrustLevel`), pas une configuration
 * qui varie par pays. Voir `apps/web/src/api/types.ts::PricingCanal`.
 */

const CANALS: { id: PricingCanal; label: string }[] = [
  { id: 'canal_1_marge', label: 'Marge (canal 1)' },
  { id: 'canal_2_commission', label: 'Commission (canal 2)' },
];

function canalLabel(canal: PricingCanal): string {
  return CANALS.find((entry) => entry.id === canal)?.label ?? canal;
}

/**
 * `POST /api/pricing/configs/` renvoie ses erreurs au format de validation
 * DRF standard (`{champ: ["message"]}`), PAS `{detail: "..."}` comme les
 * 409 de `apps/procurement` (ticket 027) — ce formulaire est le premier
 * consommateur de `ApiError.body` (voir `client.ts`). Les messages sont
 * affichés EXACTEMENT tels que renvoyés par le backend, jamais reformulés.
 */
function formatPricingApiError(caught: unknown): string {
  if (!(caught instanceof ApiError)) return 'Échec de la création du taux.';
  if (caught.detail) return caught.detail;
  if (caught.body && typeof caught.body === 'object') {
    const messages = Object.values(caught.body as Record<string, unknown>)
      .flat()
      .filter((value): value is string => typeof value === 'string');
    if (messages.length > 0) return messages.join(' ');
  }
  return 'Échec de la création du taux.';
}

function CountryPackSelector({ onLoad }: { onLoad: (countryPackId: string) => void }) {
  const [countryPackId, setCountryPackId] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onLoad(countryPackId.trim());
  }

  return (
    <section aria-label="Sélectionner un pays" style={{ marginBottom: '16px' }}>
      <AlertBanner title="Aucun sélecteur de pays disponible">
        Aucun endpoint ne permet aujourd&apos;hui de rechercher un Country Pack — dépendance
        transmise à la session backend (même modèle que la recherche Lot/Organisation, ticket
        B-028). Saisissez l&apos;identifiant UUID directement.
      </AlertBanner>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '12px' }}
      >
        <label>
          Pays (Country Pack UUID)
          <input
            type="text"
            aria-label="Pays (Country Pack UUID)"
            value={countryPackId}
            onChange={(event) => setCountryPackId(event.target.value)}
            style={{ display: 'block', marginTop: '4px', width: '360px' }}
          />
        </label>
        <button type="submit" disabled={!countryPackId.trim()}>
          Charger les tarifs de ce pays
        </button>
      </form>
    </section>
  );
}

function CurrentRatesPanel({ countryPackId, reloadKey }: { countryPackId: string; reloadKey: number }) {
  const api = useApiClient();
  const state = useApiResource(
    () => api.getCurrentPricingRates(countryPackId),
    [countryPackId, reloadKey],
  );

  return (
    <section aria-label="Taux actuels">
      <h3>Taux actuels</h3>
      {state.status === 'loading' && <p>Chargement des taux actuels…</p>}
      {state.status === 'error' && <AlertBanner title="Impossible de charger les taux actuels." />}
      {state.status === 'success' && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {CANALS.map(({ id, label }) => {
            const config = state.data[id];
            return (
              <li key={id} data-testid={`current-rate-${id}`} style={{ marginBottom: '8px' }}>
                <strong>{label}</strong> :{' '}
                {config ? (
                  <>
                    {config.rate} % — saisi par {config.created_by} le {config.created_at}
                  </>
                ) : (
                  'Aucun taux configuré.'
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * L'« ancien taux » d'une ligne n'est PAS un champ dédié côté backend — il
 * se lit en comparant deux entrées consécutives de l'historique
 * (`apps.pricing.services.get_pricing_history`, docstring explicite en ce
 * sens). Afficher `previous.rate` à côté de `entry.rate` n'est PAS un
 * calcul métier : aucune arithmétique n'a lieu, seulement la juxtaposition
 * de deux valeurs déjà authentiques et déjà fournies par le backend, dans
 * l'ordre où il les a lui-même renvoyées — même principe que
 * `CandidateVisibleStatusNote` (`DevisView.tsx`, ticket 027).
 */
function CanalHistoryPanel({
  countryPackId, canal, reloadKey,
}: { countryPackId: string; canal: PricingCanal; reloadKey: number }) {
  const api = useApiClient();
  const state = useApiResource(
    () => api.getPricingHistory(countryPackId, canal),
    [countryPackId, canal, reloadKey],
  );

  return (
    <section aria-label={`Historique — ${canalLabel(canal)}`} style={{ marginTop: '16px' }}>
      <h4>{canalLabel(canal)}</h4>
      {state.status === 'loading' && <p>Chargement de l&apos;historique…</p>}
      {state.status === 'error' && <AlertBanner title="Impossible de charger l'historique." />}
      {state.status === 'success' && (
        state.data.length === 0 ? (
          <p data-testid={`no-history-${canal}`}>Aucun taux enregistré pour l&apos;instant.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
                <th style={{ padding: '4px 8px' }}>Ancien taux</th>
                <th style={{ padding: '4px 8px' }}>Nouveau taux</th>
                <th style={{ padding: '4px 8px' }}>Saisi par</th>
                <th style={{ padding: '4px 8px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((entry, index) => {
                const previous = index > 0 ? state.data[index - 1] : null;
                return (
                  <tr key={entry.id}>
                    <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>
                      {previous ? `${previous.rate} %` : '—'}
                    </td>
                    <td style={{ padding: '4px 8px' }}>{entry.rate} %</td>
                    <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>{entry.created_by}</td>
                    <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>{entry.created_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </section>
  );
}

function CreatePricingConfigForm({ countryPackId, onCreated }: { countryPackId: string; onCreated: () => void }) {
  const api = useApiClient();
  const [canal, setCanal] = useState<PricingCanal>(CANALS[0].id);
  const [rate, setRate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createPricingConfig({ country_pack: countryPackId, canal, rate: rate.trim() });
      setRate('');
      onCreated();
    } catch (caught) {
      setError(formatPricingApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label="Créer un nouveau taux"
      style={{
        marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap',
      }}
    >
      <label>
        Canal
        <select
          aria-label="Canal"
          value={canal}
          onChange={(event) => setCanal(event.target.value as PricingCanal)}
          style={{ display: 'block', marginTop: '4px' }}
        >
          {CANALS.map(({ id, label }) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        Taux (%)
        <input
          type="text"
          inputMode="decimal"
          aria-label="Taux (%)"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          required
          style={{ display: 'block', marginTop: '4px', width: '120px' }}
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Enregistrement…' : 'Créer ce taux'}
      </button>
      {error && (
        <div style={{ width: '100%' }}>
          <AlertBanner title={error} />
        </div>
      )}
    </form>
  );
}

export function PricingView() {
  const [countryPackId, setCountryPackId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <section aria-label="Administration des tarifs">
      <h2>Tarification par pays</h2>

      {countryPackId ? (
        <div style={{ marginBottom: '16px' }}>
          <p>
            Pays sélectionné : <strong>{countryPackId}</strong>{' '}
            <button type="button" onClick={() => setCountryPackId(null)}>Changer de pays</button>
          </p>
        </div>
      ) : (
        <CountryPackSelector onLoad={setCountryPackId} />
      )}

      {countryPackId && (
        <>
          <CurrentRatesPanel countryPackId={countryPackId} reloadKey={reloadKey} />

          <h3 style={{ marginTop: '16px' }}>Historique par canal</h3>
          {CANALS.map(({ id }) => (
            <CanalHistoryPanel key={id} countryPackId={countryPackId} canal={id} reloadKey={reloadKey} />
          ))}

          <h3 style={{ marginTop: '16px' }}>Créer un nouveau taux</h3>
          <CreatePricingConfigForm countryPackId={countryPackId} onCreated={() => setReloadKey((key) => key + 1)} />
        </>
      )}
    </section>
  );
}
