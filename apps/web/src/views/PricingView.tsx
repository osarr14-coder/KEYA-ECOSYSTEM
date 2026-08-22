import { type FormEvent, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Input, Select, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { CountryPackSummary, PricingCanal } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { CountryPackSelector } from '../components/CountryPackSelector';

/**
 * Ticket F-028 — écran fonctionnel réel d'administration des tarifs,
 * périmètre admin_keyimmo : consultation des taux actifs par pays/canal,
 * historique complet, création d'un nouveau taux. Connecté à
 * `apps/pricing` (ticket 025-backend) — contrat API vérifié directement
 * dans `backend/apps/pricing/{views,serializers,services}.py` avant
 * d'écrire ce fichier.
 *
 * **Sélecteur de pays réel** (`CountryPackSelector`, `apps/web/src/
 * components/`) : `GET /api/organizations/country-packs/` (ticket B-030)
 * remplace la saisie manuelle d'UUID utilisée jusque-là — dépendance levée,
 * voir `F-028-administration-tarifs.md`, section « Levée de la dépendance
 * B-030 ».
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
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger les taux actuels." onRetry={state.refetch} />
      )}
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
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger l'historique." onRetry={state.refetch} />
      )}
      {state.status === 'success' && (
        state.data.length === 0 ? (
          <p data-testid={`no-history-${canal}`}>Aucun taux enregistré pour l&apos;instant.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ancien taux</th>
                <th>Nouveau taux</th>
                <th>Saisi par</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((entry, index) => {
                const previous = index > 0 ? state.data[index - 1] : null;
                return (
                  <tr key={entry.id}>
                    <td style={{ color: semanticColors.neutral.textMuted }}>
                      {previous ? `${previous.rate} %` : '—'}
                    </td>
                    <td>{entry.rate} %</td>
                    <td style={{ color: semanticColors.neutral.textMuted }}>{entry.created_by}</td>
                    <td style={{ color: semanticColors.neutral.textMuted }}>{entry.created_at}</td>
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
      setError(formatDrfFieldErrors(caught, 'Échec de la création du taux.'));
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
        <Select
          aria-label="Canal"
          value={canal}
          onChange={(event) => setCanal(event.target.value as PricingCanal)}
          style={{ marginTop: '4px', width: 'auto' }}
        >
          {CANALS.map(({ id, label }) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </Select>
      </label>
      <label>
        Taux (%)
        <Input
          type="text"
          inputMode="decimal"
          aria-label="Taux (%)"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          required
          style={{ marginTop: '4px', width: '120px' }}
        />
      </label>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Enregistrement…' : 'Créer ce taux'}
      </Button>
      {error && (
        <div style={{ width: '100%' }}>
          <AlertBanner title={error} />
        </div>
      )}
    </form>
  );
}

export function PricingView() {
  const [selectedCountryPack, setSelectedCountryPack] = useState<CountryPackSummary | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <section aria-label="Administration des tarifs">
      <h2>Tarification par pays</h2>

      {selectedCountryPack ? (
        <div style={{ marginBottom: '16px' }}>
          <p>
            Pays sélectionné : <strong>{selectedCountryPack.label} ({selectedCountryPack.code})</strong>{' '}
            <Button type="button" variant="secondary" onClick={() => setSelectedCountryPack(null)}>Changer de pays</Button>
          </p>
        </div>
      ) : (
        <CountryPackSelector onLoad={setSelectedCountryPack} />
      )}

      {selectedCountryPack && (
        <>
          <CurrentRatesPanel countryPackId={selectedCountryPack.id} reloadKey={reloadKey} />

          <h3 style={{ marginTop: '16px' }}>Historique par canal</h3>
          {CANALS.map(({ id }) => (
            <CanalHistoryPanel key={id} countryPackId={selectedCountryPack.id} canal={id} reloadKey={reloadKey} />
          ))}

          <h3 style={{ marginTop: '16px' }}>Créer un nouveau taux</h3>
          <CreatePricingConfigForm countryPackId={selectedCountryPack.id} onCreated={() => setReloadKey((key) => key + 1)} />
        </>
      )}
    </section>
  );
}
