import { type FormEvent, useState } from 'react';

import { AlertBanner, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { Devis, DevisAjustement } from '../api/types';
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
 * **Aucun sélecteur de lot/organisation** : ni `GET /api/programs/lots/` ni
 * `GET /api/build/lots/` ne permettent à admin_keyimmo de découvrir un lot
 * hors de ses propres memberships, et aucun endpoint ne liste les
 * organisations. Décision actée avec l'utilisateur : saisie manuelle des
 * UUID en attendant un futur ticket backend (B-028, transmis à la session
 * backend) qui ajouterait une recherche, sur le modèle de
 * `GET /api/backoffice/users/?q=` (ticket 011). Même raison : tous les
 * champs de relation d'un `Devis` (organisation, candidat, logged_by) sont
 * des UUID bruts non résolus en nom — affichés tels quels ci-dessous,
 * jamais masqués derrière un faux libellé.
 */

function LotSelector({ onLoad }: { onLoad: (organizationId: string, lotId: string) => void }) {
  const [organizationId, setOrganizationId] = useState('');
  const [lotId, setLotId] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onLoad(organizationId.trim(), lotId.trim());
  }

  return (
    <section aria-label="Sélectionner un lot" style={{ marginBottom: '16px' }}>
      <AlertBanner title="Aucun sélecteur de lot/organisation disponible">
        Aucun endpoint ne permet aujourd&apos;hui de rechercher un lot ou une organisation
        (ticket B-028, en attente côté backend). Saisissez les identifiants UUID directement.
      </AlertBanner>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '12px',
        }}
      >
        <label>
          Organisation du lot (UUID)
          <input
            type="text"
            aria-label="Organisation du lot (UUID)"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            style={{ display: 'block', marginTop: '4px', width: '280px' }}
          />
        </label>
        <label>
          Lot (UUID)
          <input
            type="text"
            aria-label="Lot (UUID)"
            value={lotId}
            onChange={(event) => setLotId(event.target.value)}
            style={{ display: 'block', marginTop: '4px', width: '280px' }}
          />
        </label>
        <button type="submit" disabled={!organizationId.trim() || !lotId.trim()}>
          Charger les devis de ce lot
        </button>
      </form>
    </section>
  );
}

function CreateDevisForm({
  organizationId, lotId, onCreated,
}: { organizationId: string; lotId: string; onCreated: () => void }) {
  const api = useApiClient();
  const [candidateOrganizationId, setCandidateOrganizationId] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createDevis({
        organization: organizationId,
        lot: lotId,
        candidate_organization: candidateOrganizationId.trim(),
        amount: amount.trim(),
      });
      setCandidateOrganizationId('');
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
      style={{
        display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '12px',
      }}
    >
      <label>
        Organisation candidate (UUID)
        <input
          type="text"
          aria-label="Organisation candidate (UUID)"
          value={candidateOrganizationId}
          onChange={(event) => setCandidateOrganizationId(event.target.value)}
          required
          style={{ display: 'block', marginTop: '4px', width: '280px' }}
        />
      </label>
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
      <button type="submit" disabled={submitting}>
        {submitting ? 'Enregistrement…' : 'Enregistrer la candidature'}
      </button>
      {error && (
        <div style={{ width: '100%' }}>
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
      {state.status === 'error' && <AlertBanner title="Impossible de charger les ajustements." />}
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

function DevisRow({
  devis, organizationId, lotAlreadyLocked, onChanged,
}: { devis: Devis; organizationId: string; lotAlreadyLocked: boolean; onChanged: () => void }) {
  return (
    <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
      <td style={{ padding: '10px 12px' }}>{devis.candidate_organization}</td>
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
      {state.status === 'error' && <AlertBanner title="Impossible de charger les devis de ce lot." />}
      {state.status === 'success' && (
        <>
          {state.data.length === 0 ? (
            <p data-testid="no-devis">Aucun devis enregistré pour ce lot.</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}`, textAlign: 'left' }}>
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
  const [selected, setSelected] = useState<{ organizationId: string; lotId: string } | null>(null);

  return (
    <section aria-label="Devis / Appels d'offres">
      <h2>Devis par lot</h2>
      <LotSelector onLoad={(organizationId, lotId) => setSelected({ organizationId, lotId })} />
      {selected && (
        <DevisListPanel key={`${selected.organizationId}-${selected.lotId}`} organizationId={selected.organizationId} lotId={selected.lotId} />
      )}
    </section>
  );
}
