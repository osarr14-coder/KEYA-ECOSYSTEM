import { useState } from 'react';

import { AlertBanner } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { CountryPackSummary } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Sélecteur de `CountryPack` — `GET /api/organizations/country-packs/`
 * (ticket B-030), réservé à `admin_keyimmo`. Remplace la saisie manuelle
 * d'UUID utilisée jusqu'au ticket B-030 (trou découvert au ticket F-028,
 * transmis comme prérequis, levé ici) — voir `F-028-administration-tarifs.md`/
 * `F-030-paliers-legaux-paiement.md`, section « Levée de la dépendance
 * B-030 », pour le détail complet.
 *
 * **Aucun paramètre de recherche côté backend** (liste complète, triée par
 * `label`, filtrée `is_active=True` DÉJÀ côté serveur) — contrairement à
 * `searchLots`/`searchOrganizations` (ticket B-028), qui exigent une saisie
 * avant tout appel. Ici, la liste se charge au montage ; le champ de
 * filtrage ci-dessous est purement CLIENT (sur la liste déjà réduite déjà
 * reçue), jamais un second appel réseau par frappe.
 *
 * Extrait de `PricingView.tsx` (ticket F-028) au ticket F-030, réutilisé
 * par `LegalPaymentTiersView.tsx` — un seul composant partagé, jamais deux
 * copies.
 */

function CountryPackList({
  packs, onLoad,
}: { packs: CountryPackSummary[]; onLoad: (pack: CountryPackSummary) => void }) {
  const [filter, setFilter] = useState('');
  const normalizedFilter = filter.trim().toLowerCase();
  const filtered = normalizedFilter
    ? packs.filter((pack) => (
      pack.label.toLowerCase().includes(normalizedFilter) || pack.code.toLowerCase().includes(normalizedFilter)
    ))
    : packs;

  return (
    <div>
      <label>
        Filtrer les pays
        <input
          type="search"
          aria-label="Filtrer les pays"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          style={{ display: 'block', marginTop: '4px', width: '280px' }}
        />
      </label>
      {filtered.length === 0 ? (
        <p data-testid="no-country-packs">Aucun pays ne correspond.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '8px' }}>
          {filtered.map((pack) => (
            <li key={pack.id}>
              <button type="button" onClick={() => onLoad(pack)} style={{ width: '100%', textAlign: 'left' }}>
                {pack.label} ({pack.code})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CountryPackSelector({ onLoad }: { onLoad: (pack: CountryPackSummary) => void }) {
  const api = useApiClient();
  const state = useApiResource(() => api.listCountryPacks(), []);

  return (
    <section aria-label="Sélectionner un pays" style={{ marginBottom: '16px' }}>
      {state.status === 'loading' && <p>Chargement des pays…</p>}
      {state.status === 'error' && <AlertBanner title="Impossible de charger la liste des pays." />}
      {state.status === 'success' && (
        state.data.length === 0 ? (
          <p data-testid="no-country-packs">Aucun pays actif disponible.</p>
        ) : (
          <CountryPackList packs={state.data} onLoad={onLoad} />
        )
      )}
    </section>
  );
}
