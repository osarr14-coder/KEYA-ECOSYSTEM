import { type FormEvent, useState } from 'react';

import { AlertBanner, ApiErrorBanner, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { LotBcCharge } from '../api/types';
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
 * `LotBcChargesPanel` ci-dessous.
 *
 * **Dernière dépendance levée (ticket F-037, backend B-038)** : la
 * « construction courante », seul poste encore non exposé isolément
 * après F-035 bis, l'est désormais via `GET .../margin/` (réponse
 * étendue) — voir `LotLedgerMarginBreakdown` ci-dessous. F-035 est
 * considéré ENTIÈREMENT clos à partir de ce ticket, voir
 * `F-035-grand-livre-lot.md`.
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
 * Ticket F-037 — décomposition COMPLÈTE de la marge (`GET .../margin/`,
 * réponse étendue par le ticket B-038 backend), ferme la dépendance
 * backend documentée depuis F-035 (« construction courante non exposée
 * comme poste isolé »). Cet endpoint 404 tant qu'aucun grand-livre
 * n'existe (contrairement à `getLotLedger`, qui renvoie `null`), donc
 * n'est monté qu'une fois l'existence du grand-livre déjà confirmée par
 * le parent (`LotLedgerPanel`, jamais avant) — remplace l'ancien
 * `LotLedgerDetail` (F-035/F-035 bis), devenu un pur pass-through une
 * fois son propre `dl` (prix/foncier/BE depuis `LotLedger`) absorbé ici.
 *
 * **Chaque poste affiché SÉPARÉMENT, dans l'ordre logique du calcul**
 * (prix de cession en haut, chaque coût déduit ensuite, marge résultante
 * en bas) — cohérent avec la doctrine de transparence du modèle
 * économique : la marge n'est jamais noyée dans le reste, toujours une
 * ligne distincte. Les 6 valeurs viennent TELLES QUELLES de la réponse
 * API, aucune arithmétique n'a lieu ici (`prix_client`, `foncier_alloue`,
 * `be_alloue`, `construction_courante`, `bc_charges_total`, `margin` —
 * `apps.procurement.services._compute_lot_ledger_margin_breakdown` fait
 * déjà tout le calcul côté backend).
 *
 * `isNegative` est une simple lecture de SIGNE sur `margin`, déjà calculée
 * par le backend — pas un calcul métier (même principe que vérifier
 * `ecart < 0` sur un `DevisAjustement` déjà reçu) : la valeur numérique
 * affichée reste EXACTEMENT `margin`, jamais retraitée.
 */
function LotLedgerMarginBreakdown({ organizationId, lotId }: { organizationId: string; lotId: string }) {
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

  const {
    prix_client: prixClient, foncier_alloue: foncierAlloue, be_alloue: beAlloue,
    construction_courante: constructionCourante, bc_charges_total: bcChargesTotal, margin,
  } = state.data;
  const isNegative = Number(margin) < 0;

  return (
    <div style={{ marginTop: '12px' }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0, fontSize: '14px' }}>
        <dt style={{ color: semanticColors.neutral.textMuted }}>Prix client (cession)</dt>
        <dd style={{ margin: 0 }} data-testid="lot-ledger-prix-client">{prixClient}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>− Foncier alloué</dt>
        <dd style={{ margin: 0 }} data-testid="lot-ledger-foncier-alloue">{foncierAlloue}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>− BE alloué</dt>
        <dd style={{ margin: 0 }} data-testid="lot-ledger-be-alloue">{beAlloue}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>− Construction courante</dt>
        <dd style={{ margin: 0 }} data-testid="lot-ledger-construction-courante">{constructionCourante}</dd>
        <dt style={{ color: semanticColors.neutral.textMuted }}>− Charges bureau de contrôle</dt>
        <dd style={{ margin: 0 }} data-testid="lot-ledger-bc-charges-total">{bcChargesTotal}</dd>
      </dl>

      {isNegative ? (
        // Ticket F-035 — marge négative : réutilise AlertBanner (couleur
        // ambre existante, semanticColors.alert) plutôt qu'un nouveau
        // token de couleur dédié — décision explicite, cohérent avec
        // l'usage déjà établi d'AlertBanner pour tout état qui demande
        // attention dans ce projet. Jamais la couleur SEULE : le libellé
        // l'indique aussi.
        <div style={{ marginTop: '8px' }}>
          <AlertBanner title={`Marge disponible : ${margin} (négative)`}>
            Le prix client ne couvre plus le foncier alloué, le BE alloué, la construction courante et
            les charges bureau de contrôle de ce lot.
          </AlertBanner>
        </div>
      ) : (
        <p data-testid="lot-ledger-margin" style={{ margin: '8px 0 0' }}>
          = Marge disponible : <strong>{margin}</strong>
        </p>
      )}
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
 * **Aucun total RECALCULÉ ici, même si la valeur existe désormais
 * ailleurs** : `LotLedgerMarginBreakdown` ci-dessus affiche déjà
 * `bc_charges_total` (ticket F-037, réponse `/margin/`) — ce panneau-ci
 * reste volontairement dédié aux lignes INDIVIDUELLES (une par charge),
 * jamais une resomme locale des montants listés, qui dupliquerait un
 * calcul déjà fait côté backend pour aucun bénéfice.
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
          <table>
            <thead>
              <tr style={{ color: semanticColors.neutral.textMuted }}>
                <th>Jalon</th>
                <th>Montant</th>
                <th>Type</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((charge: LotBcCharge) => (
                <tr key={charge.id}>
                  <td>{charge.jalon_type}</td>
                  <td>{charge.montant}</td>
                  <td style={{ color: semanticColors.neutral.textMuted }}>
                    {charge.is_global_reference ? 'Forfait global' : 'Tarif fixe (jalon)'}
                  </td>
                  <td style={{ color: semanticColors.neutral.textMuted }}>{charge.created_at}</td>
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
          <LotLedgerMarginBreakdown organizationId={organizationId} lotId={lotId} />
        )
      )}

      {/* Sibling des deux branches ci-dessus, jamais imbriqué — les
          charges BC s'accumulent indépendamment de l'existence du
          grand-livre (voir docstring de LotBcChargesPanel). */}
      <LotBcChargesPanel organizationId={organizationId} lotId={lotId} />
    </section>
  );
}
