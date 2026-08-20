import {
  type FormEvent, type ReactNode, useEffect, useRef, useState,
} from 'react';

import { AlertBanner, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type {
  Devis, DevisAjustement, LotSearchResult, OrganizationSearchResult,
} from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket 027 — écran fonctionnel réel (remplace la maquette visuelle du
 * ticket 025/026, `DevisAppelOffreMockup.tsx`, supprimée). Périmètre
 * admin_keyimmo : enregistrer une candidature reçue hors plateforme
 * (`create_devis`), verrouiller le devis retenu (`lock_devis`), enregistrer
 * un ajustement de réconciliation (`create_ajustement`) — contrat API
 * vérifié directement dans `backend/apps/procurement/{services,serializers,
 * views}.py` avant d'écrire ce fichier, voir `F-027-devis-fonctionnel.md`.
 *
 * **Sélection du lot/de l'organisation candidate — recherche réelle (ticket
 * B-028, backend)** : `GET /api/procurement/admin/lots/?q=`/`GET
 * /api/procurement/admin/organizations/?q=` remplacent la saisie manuelle
 * d'UUID qu'utilisait ce fichier jusqu'ici.
 *
 * **Noms lisibles dans la liste des devis (ticket F-029, backend B-029)** :
 * `DevisRow` affichait `candidate_organization` en UUID brut — remplacé par
 * `devis.candidate_organization_detail.name`/`devis.lot_detail` (nom du lot
 * + programme parent), tous deux ajoutés PAR-DESSUS les UUID bruts existants
 * côté backend (jamais à leur place). Les UUID restent accessibles, jamais
 * simplement masqués : `title` (infobulle navigateur) + `data-*` sur chaque
 * cellule concernée. `logged_by` reste un UUID brut, sans équivalent
 * `_detail` côté backend — hors scope de B-029/F-029.
 */

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Debounce + garde de réponse périmée : un `clearTimeout` seul n'annule que
 * les requêtes pas encore PARTIES — une requête déjà en vol quand une
 * frappe plus récente la dépasse doit encore être ignorée à sa résolution,
 * jamais appliquée par-dessus un résultat plus frais (même discipline anti-
 * course que `syncEngine.ts`, CONTROL PWA, tickets 015/016 : comparer l'état
 * réel au moment de la résolution, pas seulement au moment du départ).
 */
function useDebouncedSearch<T>(searchFn: (query: string) => Promise<T[]>, query: string) {
  const [results, setResults] = useState<T[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  // Ticket F-033 (vague 3) — même principe que `useApiResource.refetch()` :
  // un compteur inclus dans les deps de l'effet, pour qu'un bouton
  // "Réessayer" relance EXACTEMENT la même recherche sans dupliquer sa
  // logique. Toujours au travers du MÊME debounce (250ms, imperceptible) —
  // jamais un second chemin direct qui contournerait les gardes anti-course
  // ci-dessous (`cancelled`/`latestQueryRef`).
  const [reloadToken, setReloadToken] = useState(0);
  const latestQueryRef = useRef(query);

  useEffect(() => {
    let cancelled = false;
    latestQueryRef.current = query;
    const trimmed = query.trim();

    if (!trimmed) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }

    setStatus('loading');
    const timeoutId = setTimeout(() => {
      searchFn(trimmed)
        .then((data) => {
          if (cancelled || latestQueryRef.current !== query) return;
          setResults(data);
          setStatus('success');
        })
        .catch(() => {
          if (cancelled || latestQueryRef.current !== query) return;
          setStatus('error');
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchFn, reloadToken]);

  return { results, status, retry: () => setReloadToken((token) => token + 1) };
}

/**
 * Sélecteur générique par recherche en direct — partagé entre lot et
 * organisation candidate, seuls le libellé, la fonction de recherche et le
 * rendu d'un résultat diffèrent.
 */
function LiveSearchPicker<T>({
  label, placeholder, searchFn, renderResult, getKey, onSelect,
}: {
  label: string;
  placeholder: string;
  searchFn: (query: string) => Promise<T[]>;
  renderResult: (item: T) => ReactNode;
  getKey: (item: T) => string;
  onSelect: (item: T) => void;
}) {
  const [query, setQuery] = useState('');
  const { results, status, retry } = useDebouncedSearch(searchFn, query);

  return (
    <div>
      <label>
        {label}
        <input
          type="search"
          aria-label={label}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          style={{ display: 'block', marginTop: '4px', width: '360px' }}
        />
      </label>
      {status === 'loading' && <p style={{ fontSize: '13px' }}>Recherche…</p>}
      {status === 'error' && (
        <AlertBanner title="Impossible d'effectuer la recherche." onRetry={retry} />
      )}
      {status === 'success' && results.length === 0 && (
        <p data-testid="no-search-results" style={{ fontSize: '13px' }}>Aucun résultat.</p>
      )}
      {status === 'success' && results.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '4px' }}>
          {results.map((item) => (
            <li key={getKey(item)}>
              <button type="button" onClick={() => onSelect(item)} style={{ width: '100%', textAlign: 'left' }}>
                {renderResult(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Lots DÉJÀ verrouillés exclus par le backend (`search_lots_as_admin`,
 * décision D, ticket B-028) — jamais un filtre reconstruit ici. Le nom du
 * programme (et de l'organisation) désambiguïse deux lots de même nom dans
 * des programmes différents.
 */
function LotPicker({ onSelect }: { onSelect: (lot: LotSearchResult) => void }) {
  const api = useApiClient();
  return (
    <LiveSearchPicker<LotSearchResult>
      label="Rechercher un lot (nom)"
      placeholder="Nom du lot…"
      searchFn={api.searchLots}
      getKey={(lot) => lot.id}
      renderResult={(lot) => `${lot.name} — ${lot.program.name} (${lot.organization.name})`}
      onSelect={onSelect}
    />
  );
}

function OrganizationPicker({ onSelect }: { onSelect: (organization: OrganizationSearchResult) => void }) {
  const api = useApiClient();
  return (
    <LiveSearchPicker<OrganizationSearchResult>
      label="Rechercher une organisation candidate (nom)"
      placeholder="Nom de l'organisation…"
      searchFn={api.searchOrganizations}
      getKey={(organization) => organization.id}
      renderResult={(organization) => organization.name}
      onSelect={onSelect}
    />
  );
}

function CreateDevisForm({
  organizationId, lotId, onCreated,
}: { organizationId: string; lotId: string; onCreated: () => void }) {
  const api = useApiClient();
  const [candidateOrganization, setCandidateOrganization] = useState<OrganizationSearchResult | null>(null);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!candidateOrganization) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createDevis({
        organization: organizationId,
        lot: lotId,
        candidate_organization: candidateOrganization.id,
        amount: amount.trim(),
      });
      setCandidateOrganization(null);
      setAmount('');
      onCreated();
    } catch (caught) {
      // Ticket 026 backend — 409 sur lot déjà verrouillé
      // (`LotAlreadyLockedError`) ou absence de `PricingConfig` actif pour
      // le pays du lot (`NoPricingConfigError`) : le message exact vient du
      // backend (`ApiError.detail`), jamais reconstruit ici.
      const detail = caught instanceof ApiError ? caught.detail : undefined;
      setError(detail ?? 'Échec de l’enregistrement de la candidature.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label="Enregistrer une candidature"
      style={{ marginTop: '12px' }}
    >
      {candidateOrganization ? (
        <p>
          Organisation candidate : <strong>{candidateOrganization.name}</strong>{' '}
          <button type="button" onClick={() => setCandidateOrganization(null)}>Changer</button>
        </p>
      ) : (
        <OrganizationPicker onSelect={setCandidateOrganization} />
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '8px' }}>
        <label>
          Montant
          <input
            type="text"
            inputMode="decimal"
            aria-label="Montant"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            style={{ display: 'block', marginTop: '4px', width: '160px' }}
          />
        </label>
        <button type="submit" disabled={submitting || !candidateOrganization}>
          {submitting ? 'Enregistrement…' : 'Enregistrer la candidature'}
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

function LockButton({
  devis, organizationId, lotAlreadyLocked, onLocked,
}: { devis: Devis; organizationId: string; lotAlreadyLocked: boolean; onLocked: () => void }) {
  const api = useApiClient();
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLock() {
    setLocking(true);
    setError(null);
    try {
      await api.lockDevis(devis.id, organizationId);
      onLocked();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.detail : undefined;
      setError(detail ?? 'Échec du verrouillage.');
    } finally {
      setLocking(false);
    }
  }

  if (devis.status === 'devis_verrouille') {
    return <span data-testid="devis-status" data-status="devis_verrouille">Verrouillé</span>;
  }

  return (
    <div>
      <button type="button" onClick={() => { void handleLock(); }} disabled={locking || lotAlreadyLocked}>
        {locking ? 'Verrouillage…' : lotAlreadyLocked ? 'Lot déjà verrouillé' : 'Verrouiller'}
      </button>
      {error && <AlertBanner title={error} />}
    </div>
  );
}

/**
 * Ticket 027 — ce que voit ACTUELLEMENT le candidat pour ce devis, dérivé
 * localement de données déjà chargées (`devis.status` + le nombre
 * d'ajustements déjà récupérés) : ce n'est PAS un calcul métier (la règle de
 * gating elle-même vit exclusivement backend,
 * `apps.procurement.services.get_candidate_visible_devis_status`, ticket
 * 024) — seulement l'affichage d'une règle déjà connue et vérifiée dans le
 * code backend, sur des données déjà exactes. Distinct de `LockButton`
 * ci-dessus à dessein, même raisonnement que la maquette dont cet écran
 * prend la suite (ticket 026) : l'admin peut voir « Verrouillé » alors que
 * son candidat voit encore « Candidat », et c'est précisément ce que cet
 * écran doit montrer, pas cacher.
 */
function CandidateVisibleStatusNote({ devis, ajustementsCount }: { devis: Devis; ajustementsCount: number }) {
  if (devis.status !== 'devis_verrouille') return null;

  const isGagnant = ajustementsCount > 0;

  return (
    <p
      data-testid="candidate-visible-status"
      data-status={isGagnant ? 'gagnant' : 'candidat'}
      style={{ margin: '4px 0 0', fontSize: '13px', color: semanticColors.neutral.textMuted }}
    >
      Vue candidat : {isGagnant ? (
        <strong style={{ color: semanticColors.neutral.text }}>« Gagnant »</strong>
      ) : (
        <>encore « Candidat » (aucune réconciliation acceptée)</>
      )}
    </p>
  );
}

function CreateAjustementForm({
  devis, organizationId, onCreated,
}: { devis: Devis; organizationId: string; onCreated: () => void }) {
  const api = useApiClient();
  const [ecart, setEcart] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createAjustement(devis.id, { organization: organizationId, ecart: ecart.trim() });
      setEcart('');
      onCreated();
    } catch (caught) {
      // 409 possibles : `DevisNotLockedError` (ne devrait pas arriver ici,
      // ce formulaire n'est rendu que pour un devis déjà verrouillé) ou
      // `MarginExceededError` (écart au-delà de la marge disponible
      // courante, ticket 023) — message exact fourni par le backend.
      const detail = caught instanceof ApiError ? caught.detail : undefined;
      setError(detail ?? 'Échec de l’enregistrement de l’ajustement.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label={`Enregistrer un ajustement pour ${devis.id}`}
      style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '8px' }}
    >
      <label>
        Écart (signé — positif = défavorable, négatif = favorable)
        <input
          type="text"
          inputMode="decimal"
          aria-label="Écart"
          value={ecart}
          onChange={(event) => setEcart(event.target.value)}
          required
          style={{ display: 'block', marginTop: '4px', width: '220px' }}
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Enregistrement…' : 'Enregistrer un ajustement'}
      </button>
      {error && (
        <div style={{ width: '100%' }}>
          <AlertBanner title={error} />
        </div>
      )}
    </form>
  );
}

function AjustementsPanel({ devis, organizationId }: { devis: Devis; organizationId: string }) {
  const api = useApiClient();
  const [reloadKey, setReloadKey] = useState(0);
  const state = useApiResource(
    () => api.listAjustements(devis.id, organizationId),
    [devis.id, organizationId, reloadKey],
  );

  if (devis.status !== 'devis_verrouille') return null;

  const ajustements: DevisAjustement[] = state.status === 'success' ? state.data : [];

  return (
    <div style={{ marginTop: '8px', paddingLeft: '12px', borderLeft: `2px solid ${semanticColors.neutral.border}` }}>
      <p style={{ margin: '0 0 4px', fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        Marge estimée : {devis.marge_estimee}
      </p>
      <CandidateVisibleStatusNote devis={devis} ajustementsCount={ajustements.length} />

      {state.status === 'loading' && <p style={{ fontSize: '13px' }}>Chargement des ajustements…</p>}
      {state.status === 'error' && (
        <AlertBanner title="Impossible de charger les ajustements." onRetry={state.refetch} />
      )}
      {state.status === 'success' && (
        ajustements.length === 0 ? (
          <p style={{ margin: '4px 0', fontSize: '13px' }}>Aucun ajustement enregistré pour l&apos;instant.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: '13px', marginTop: '4px', marginBottom: '8px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: semanticColors.neutral.textMuted }}>
                <th style={{ padding: '4px 8px' }}>Écart</th>
                <th style={{ padding: '4px 8px' }}>Saisi par</th>
                <th style={{ padding: '4px 8px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {ajustements.map((ajustement) => (
                <tr key={ajustement.id}>
                  <td style={{ padding: '4px 8px' }}>{ajustement.ecart}</td>
                  <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>{ajustement.created_by}</td>
                  <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>{ajustement.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      <CreateAjustementForm devis={devis} organizationId={organizationId} onCreated={() => setReloadKey((key) => key + 1)} />
    </div>
  );
}

/**
 * Ticket F-029 — noms lisibles (lot, programme parent, organisation
 * candidate) affichés PAR-DESSUS les UUID bruts, jamais à leur place :
 * chaque cellule concernée porte `title` (infobulle navigateur) ET un
 * attribut `data-*` technique pointant vers l'UUID réel — un test peut donc
 * vérifier l'UUID sans dépendre du rendu d'une infobulle au survol.
 */
function DevisRow({
  devis, organizationId, lotAlreadyLocked, onChanged,
}: { devis: Devis; organizationId: string; lotAlreadyLocked: boolean; onChanged: () => void }) {
  return (
    <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
      <td
        style={{ padding: '10px 12px' }}
        title={devis.lot}
        data-lot-id={devis.lot}
      >
        {devis.lot_detail.name} — {devis.lot_detail.program.name}
      </td>
      <td
        style={{ padding: '10px 12px' }}
        title={devis.candidate_organization}
        data-organization-id={devis.candidate_organization}
      >
        {devis.candidate_organization_detail.name}
      </td>
      <td style={{ padding: '10px 12px' }}>{devis.amount}</td>
      <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{devis.logged_by}</td>
      <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{devis.created_at}</td>
      <td style={{ padding: '10px 12px' }}>
        <LockButton devis={devis} organizationId={organizationId} lotAlreadyLocked={lotAlreadyLocked} onLocked={onChanged} />
        <AjustementsPanel devis={devis} organizationId={organizationId} />
      </td>
    </tr>
  );
}

function DevisListPanel({ organizationId, lotId }: { organizationId: string; lotId: string }) {
  const api = useApiClient();
  const [reloadKey, setReloadKey] = useState(0);
  const state = useApiResource(
    () => api.listDevisForLot(lotId, organizationId),
    [lotId, organizationId, reloadKey],
  );

  function handleChanged() {
    setReloadKey((key) => key + 1);
  }

  return (
    <section aria-label={`Devis pour le lot ${lotId}`}>
      {state.status === 'loading' && <p>Chargement des devis…</p>}
      {state.status === 'error' && (
        <AlertBanner title="Impossible de charger les devis de ce lot." onRetry={state.refetch} />
      )}
      {state.status === 'success' && (
        <>
          {state.data.length === 0 ? (
            <p data-testid="no-devis">Aucun devis enregistré pour ce lot.</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}`, textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>Lot</th>
                  <th style={{ padding: '10px 12px' }}>Organisation candidate</th>
                  <th style={{ padding: '10px 12px' }}>Montant</th>
                  <th style={{ padding: '10px 12px' }}>Saisi par</th>
                  <th style={{ padding: '10px 12px' }}>Date</th>
                  <th style={{ padding: '10px 12px' }}>Statut</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((devis) => (
                  <DevisRow
                    key={devis.id}
                    devis={devis}
                    organizationId={organizationId}
                    lotAlreadyLocked={state.data.some((row) => row.status === 'devis_verrouille')}
                    onChanged={handleChanged}
                  />
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: '16px' }}>Enregistrer une candidature reçue hors plateforme</h3>
          <CreateDevisForm organizationId={organizationId} lotId={lotId} onCreated={handleChanged} />
        </>
      )}
    </section>
  );
}

export function DevisView() {
  const [selectedLot, setSelectedLot] = useState<LotSearchResult | null>(null);

  return (
    <section aria-label="Devis / Appels d'offres">
      <h2>Devis par lot</h2>

      {selectedLot ? (
        <div style={{ marginBottom: '16px' }}>
          <p>
            Lot sélectionné : <strong>{selectedLot.name}</strong> — {selectedLot.program.name} ({selectedLot.organization.name}){' '}
            <button type="button" onClick={() => setSelectedLot(null)}>Changer de lot</button>
          </p>
        </div>
      ) : (
        <div style={{ marginBottom: '16px' }}>
          <LotPicker onSelect={setSelectedLot} />
        </div>
      )}

      {selectedLot && (
        <DevisListPanel
          key={`${selectedLot.organization.id}-${selectedLot.id}`}
          organizationId={selectedLot.organization.id}
          lotId={selectedLot.id}
        />
      )}
    </section>
  );
}
