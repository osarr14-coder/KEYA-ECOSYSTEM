import { type FormEvent, useState } from 'react';

import { AlertBanner, ApiErrorBanner, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { LotBcCharge, LotLedger } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-035 — grand-livre de coûts par lot (canal 1), consommant
 * `LotLedger` (ticket B-035 backend) — jamais consommé côté frontend
 * jusqu'ici. Contrat API vérifié directement dans
 * `backend/apps/procurement/{models,services,views,serializers}.py` avant
 * d'écrire ce fichier, voir `F-035-grand-livre-lot.md`.
 *
 * **Monté depuis `DevisView.tsx::DevisListPanel`, jamais un nouvel onglet
 * avec sa propre recherche de lot** : `search_lots_as_admin` (ticket
 * B-028) exclut les lots DÉJÀ verrouillés de ses résultats — une fois un
 * devis verrouillé, ce lot ne réapparaît plus jamais dans `LotPicker`. Le
 * seul endroit où ce lot reste accessible est l'état déjà sélectionné dans
 * `DevisView` — intégrer ce panneau là (une fois `lotAlreadyLocked`) n'est
 * donc pas qu'un choix pratique, c'est la SEULE option qui fonctionne.
 *
 * **Correctif post-livraison (F-035 bis)** : la livraison initiale
 * affirmait que `LotBcCharge` (ticket B-036) n'existait pas côté backend
 * — FAUX, `master` avait déjà fusionné B-036 (commit `5de9293`) AVANT le
 * début de ce ticket, mais cette branche n'avait jamais synchronisé ce
 * commit avant d'écrire ce fichier. Une fois `git fetch`/`merge` refaits,
 * `LotBcCharge`/`GET .../bc-charges/` existent bel et bien — voir
 * `LotBcChargesPanel` ci-dessous. Seule la « construction courante »
 * reste une dépendance backend bloquante réelle (voir
 * `F-035-grand-livre-lot.md`, section « Correction post-fusion »).
 */

function CreateLotLedgerForm({
  organizationId, lotId, onCreated,
}: { organizationId: string; lotId: string; onCreated: () => void }) {
  const api = useApiClient();
  const [prixClient, setPrixClient] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createLotLedger({
        organization: organizationId, lot: lotId, prix_client: prixClient.trim(),
      });
      setPrixClient('');
      onCreated();
    } catch (caught) {
      // 409 (LotDevisNotLockedError/LotLedgerAlreadyExistsError/
      // NoProgramCostError/LotMissingSurfaceError) OU 400 DRF (prix_client
      // mal formé) — message backend EXACT, jamais reconstruit ici (même
      // utilitaire que PricingView/LegalPaymentTiersView, F-028/F-030).
      setError(formatDrfFieldErrors(caught, 'Échec de la création du grand-livre.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label="Créer le grand-livre du lot"
      style={{ marginTop: '12px' }}
    >
      <p style={{ margin: '0 0 8px', fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        Aucun grand-livre n&apos;existe encore pour ce lot.
      </p>
      <label>
        Prix client
        <input
          type="text"
          inputMode="decimal"
          aria-label="Prix client"
          value={prixClient}
          onChange={(event) => setPrixClient(event.target.value)}
          required
          style={{ display: 'block', marginTop: '4px', width: '200px' }}
        />
      </label>
      <button type="submit" disabled={submitting} style={{ marginTop: '8px' }}>
        {submitting ? 'Création…' : 'Créer le grand-livre'}
      </button>
      {error && (
        <div style={{ marginTop: '8px' }}>
          <AlertBanner title={error} />
        </div>
      )}
    </form>
  );
}

/**
 * Marge disponible COURANTE (`GET .../margin/`) — composant SÉPARÉ du
 * reste du détail : cet endpoint 404 tant qu'aucun grand-livre n'existe
 * (contrairement au détail lui-même, qui renvoie `null`), donc n'est
 * appelé qu'une fois l'existence du grand-livre déjà confirmée par le
 * parent (`LotLedgerDetail`, jamais avant).
 *
 * `isNegative` est une simple lecture de SIGNE sur une valeur déjà
 * calculée par le backend — pas un calcul métier (même principe que
 * vérifier `ecart < 0` sur un `DevisAjustement` déjà reçu) : la valeur
 * numérique affichée reste EXACTEMENT `margin`, jamais retraitée.
 */
function LotLedgerMargin({ organizationId, lotId }: { organizationId: string; lotId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getLotLedgerMargin(lotId, organizationId), [lotId, organizationId]);

  if (state.status === 'loading') {
    return <p style={{ fontSize: '13px' }}>Chargement de la marge disponible…</p>;
  }
  if (state.status === 'error') {
    return (
      <ApiErrorBanner error={state.error} title="Impossible de charger la marge disponible." onRetry={state.refetch} />
    );
  }

  const isNegative = Number(state.data.margin) < 0;

  if (isNegative) {
    // Ticket F-035 — marge négative : réutilise AlertBanner (couleur
    // ambre existante, semanticColors.alert) plutôt qu'un nouveau token
    // de couleur dédié — décision explicite, cohérent avec l'usage déjà
    // établi d'AlertBanner pour tout état qui demande attention dans ce
    // projet. Jamais la couleur SEULE : le libellé l'indique aussi.
    return (
      <AlertBanner title={`Marge disponible : ${state.data.margin} (négative)`}>
        Le prix client ne couvre plus le foncier alloué, le BE alloué et la construction courante de ce lot.
      </AlertBanner>
    );
  }

  return (
    <p data-testid="lot-ledger-margin" style={{ margin: '8px 0 0' }}>
      Marge disponible : <strong>{state.data.margin}</strong>
    </p>
  );
}

function LotLedgerDetail({
  ledger, organizationId, lotId,
}: { ledger: LotLedger; organizationId: string; lotId: string }) {
  return (
    <div style={{ marginTop: '12px' }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0, fontSize: '14px' }}>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Prix client</dt>
        <dd style={{ margin: 0 }} data-testid="lot-ledger-prix-client">{ledger.prix_client}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Foncier alloué</dt>
        <dd style={{ margin: 0 }} data-testid="lot-ledger-foncier-alloue">{ledger.foncier_alloue}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>BE alloué</dt>
        <dd style={{ margin: 0 }} data-testid="lot-ledger-be-alloue">{ledger.be_alloue}</dd>
      </dl>

      {/* Ticket F-035 — mention EXPLICITE de la dépendance backend
          bloquante restante (jamais un silence) : la construction courante
          n'est toujours pas exposée comme poste isolé par l'API (seule la
          marge finale, déjà nette de ce terme, l'est). Le détail de la
          construction (devis + ajustements) reste consultable dans le
          tableau de devis ci-dessus, sur ce MÊME écran — jamais un renvoi
          vers un autre onglet, ce panneau est intégré à DevisView. Les
          charges bureau de contrôle, elles, sont bien listées ci-dessous
          (`LotBcChargesPanel`) — B-036, fusionné dans master avant ce
          ticket sans que cette branche ne l'ait synchronisé à temps. */}
      <p style={{ margin: '8px 0 0', fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        Détail de la construction (devis verrouillé + ajustements) : voir le tableau de devis ci-dessus.
        La marge disponible ci-dessous est déjà nette de la construction courante — son montant isolé
        n&apos;est pas encore exposé comme poste séparé par l&apos;API (dépendance backend).
      </p>

      <LotLedgerMargin organizationId={organizationId} lotId={lotId} />
    </div>
  );
}

/**
 * Ticket F-035 bis (ticket B-036 backend, LotBcCharge) — historique
 * COMPLET des charges bureau de contrôle d'un lot. Rendu comme SIBLING de
 * `CreateLotLedgerForm`/`LotLedgerDetail` dans `LotLedgerPanel`, jamais
 * imbriqué dans l'un ou l'autre : `LotBcCharge` a une FK DIRECTE vers
 * `Lot`, PAS vers `LotLedger` (voir `backend/apps/procurement/models.py`)
 * — les charges s'accumulent dès la première mission d'inspection, quel
 * que soit l'état du grand-livre (même avant sa création). Ce panneau
 * reste donc visible dans les DEUX états.
 *
 * **Aucun total affiché** : la somme des charges est déjà intégrée à la
 * marge disponible (`get_lot_ledger_margin`, `- Σ LotBcCharge.montant`),
 * mais cette somme elle-même n'est exposée par AUCUN endpoint comme valeur
 * isolée — la recalculer ici en sommant les lignes listées serait un
 * calcul frontend, même limite que « construction courante » ci-dessus.
 * Seules les lignes individuelles (valeurs API directes) sont affichées.
 */
function LotBcChargesPanel({ organizationId, lotId }: { organizationId: string; lotId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getLotBcCharges(lotId, organizationId), [lotId, organizationId]);

  return (
    <div style={{ marginTop: '16px' }}>
      <h4 style={{ margin: '0 0 4px' }}>Charges bureau de contrôle</h4>

      {state.status === 'loading' && <p style={{ fontSize: '13px' }}>Chargement des charges…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner
          error={state.error}
          title="Impossible de charger les charges bureau de contrôle."
          onRetry={state.refetch}
        />
      )}
      {state.status === 'success' && (
        state.data.length === 0 ? (
          <p style={{ fontSize: '13px', margin: 0, color: semanticColors.neutral.textMuted }}>
            Aucune charge bureau de contrôle enregistrée pour l&apos;instant.
          </p>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: semanticColors.neutral.textMuted }}>
                <th style={{ padding: '4px 8px' }}>Jalon</th>
                <th style={{ padding: '4px 8px' }}>Montant</th>
                <th style={{ padding: '4px 8px' }}>Type</th>
                <th style={{ padding: '4px 8px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((charge: LotBcCharge) => (
                <tr key={charge.id}>
                  <td style={{ padding: '4px 8px' }}>{charge.jalon_type}</td>
                  <td style={{ padding: '4px 8px' }}>{charge.montant}</td>
                  <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>
                    {charge.is_global_reference ? 'Forfait global' : 'Tarif fixe (jalon)'}
                  </td>
                  <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>{charge.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

export function LotLedgerPanel({
  organizationId, lotId,
}: { organizationId: string; lotId: string }) {
  const api = useApiClient();
  const [reloadKey, setReloadKey] = useState(0);
  const state = useApiResource(
    () => api.getLotLedger(lotId, organizationId),
    [lotId, organizationId, reloadKey],
  );

  return (
    <section
      aria-label="Grand-livre du lot"
      style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${semanticColors.neutral.border}` }}
    >
      <h3 style={{ margin: '0 0 4px' }}>Grand-livre de coûts</h3>

      {state.status === 'loading' && <p>Chargement du grand-livre…</p>}
      {state.status === 'error' && (
        <ApiErrorBanner error={state.error} title="Impossible de charger le grand-livre." onRetry={state.refetch} />
      )}
      {state.status === 'success' && (
        state.data === null ? (
          <CreateLotLedgerForm
            organizationId={organizationId}
            lotId={lotId}
            onCreated={() => setReloadKey((key) => key + 1)}
          />
        ) : (
          <LotLedgerDetail ledger={state.data} organizationId={organizationId} lotId={lotId} />
        )
      )}

      {/* Sibling des deux branches ci-dessus, jamais imbriqué — les
          charges BC s'accumulent indépendamment de l'existence du
          grand-livre (voir docstring de LotBcChargesPanel). */}
      <LotBcChargesPanel organizationId={organizationId} lotId={lotId} />
    </section>
  );
}
