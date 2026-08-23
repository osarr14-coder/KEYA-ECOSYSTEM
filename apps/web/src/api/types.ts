/**
 * Types miroir des payloads JSON du backend — snake_case, exactement ce que
 * l'API renvoie (même convention que apps/home, apps/build).
 */

export interface LoginResult {
  access: string;
  refresh: string;
}

/** Miroir de `apps.accounts.serializers.MembershipSummarySerializer`. */
export interface MeMembership {
  organization_id: string;
  organization_name: string;
  role_code: string;
  role_label: string;
}

/** Miroir de `apps.accounts.serializers.MeSerializer` (`GET /api/me/`). */
export interface Me {
  id: string;
  email: string;
  full_name: string;
  memberships: MeMembership[];
}

/**
 * Miroir de `apps.backoffice.serializers.UserSummarySerializer` (ticket
 * 011) — À NE PAS confondre avec `Me` ci-dessus : c'est un AUTRE
 * utilisateur (la cible d'une recherche back-office), pas l'utilisateur
 * connecté, et ce serializer n'expose ni memberships ni rôle.
 */
export interface BackofficeUserSummary {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
}

/**
 * Miroir de `apps.backoffice.serializers.MembershipSummarySerializer`
 * (ticket 011) — clés différentes de `MeMembership` (`role`, pas
 * `role_code`/`role_label` : ce serializer n'expose aucun libellé de rôle
 * traduit, contrairement à `apps.accounts.serializers.MeSerializer`).
 */
export interface BackofficeMembershipSummary {
  organization_id: string;
  organization_name: string;
  role: string;
}

/** Miroir de `apps.backoffice.serializers.UserDetailSerializer` (ticket
 * 011) — strictement lecture seule côté backend, aucun champ de
 * modification. */
export interface BackofficeUserDetail {
  user: BackofficeUserSummary;
  memberships: BackofficeMembershipSummary[];
}

/** Statut RÉEL d'un devis (`apps.procurement.services.get_devis_status`,
 * ticket 022) — jamais gaté par une réconciliation, contrairement au statut
 * exposé au candidat (`get_candidate_visible_devis_status`, ticket 024).
 * Ce module (`apps/web`, périmètre admin_keyimmo) ne consomme jamais
 * `DevisCandidateSerializer` — la vue « ce que voit le candidat » est
 * dérivée localement (voir `DevisView.tsx::CandidateVisibleStatusNote`),
 * jamais par un second appel API réservé au rôle constructeur. */
export type DevisStatus = 'candidat' | 'devis_verrouille';

/** Miroir de `apps.procurement.serializers.DevisAdminSerializer` — seul
 * serializer de ce module à exposer `amount`/`marge_estimee` (ticket 027).
 * `organization`/`candidate_organization`/`lot`/`logged_by` restent des
 * UUID bruts (`ModelSerializer` par défaut, aucun champ imbriqué) — mais
 * depuis le ticket B-029, `lot_detail`/`candidate_organization_detail`
 * viennent EN PLUS (jamais à la place, décision A du ticket) résoudre le
 * lot et l'organisation candidate en noms lisibles, réutilisant LITTÉRALEMENT
 * `LotSearchResult`/`OrganizationSearchResult` (mêmes serializers que la
 * recherche B-028). `logged_by` reste un UUID brut, sans équivalent
 * `_detail` — hors scope de B-029, voir `F-029-noms-lisibles-devis.md`. */
export interface Devis {
  id: string;
  organization: string;
  candidate_organization: string;
  lot: string;
  amount: string;
  marge_estimee: string;
  logged_by: string;
  created_at: string;
  status: DevisStatus;
  lot_detail: LotSearchResult;
  candidate_organization_detail: OrganizationSearchResult;
}

/** Miroir de `apps.procurement.serializers.DevisAjustementAdminSerializer`
 * (`GET /api/procurement/devis/{id}/ajustements/`) — jamais de
 * `marge_resultante` sur cette forme, voir `DevisAjustementCreateResult`
 * pour la réponse `POST`, qui seule le porte. */
export interface DevisAjustement {
  id: string;
  devis: string;
  organization: string;
  ecart: string;
  created_by: string;
  created_at: string;
}

/** Réponse de `POST /api/procurement/devis/{id}/ajustements/` — même champs
 * que `DevisAjustement`, plus `marge_resultante` (calculée backend,
 * `apps.procurement.services.create_ajustement`, jamais recalculée ici). */
export interface DevisAjustementCreateResult extends DevisAjustement {
  marge_resultante: string;
}

/** Miroir de `apps.procurement.serializers.OrganizationSearchResultSerializer`
 * (`GET /api/procurement/admin/organizations/?q=`, ticket B-028). Aucun champ
 * sensible — `Organization` n'en porte aucun côté backend. */
export interface OrganizationSearchResult {
  id: string;
  name: string;
}

/** Miroir de `apps.programs.serializers.ProgramSerializer` (`POST
 * /api/programs/`, ticket B-039/F-049). Réservé en écriture à
 * `admin_keyimmo` — voir `createProgram` (`api/client.ts`), organisation
 * cible fournie explicitement, jamais dérivée de l'organisation active de
 * l'appelant. */
export interface Program {
  id: string;
  name: string;
  created_at: string;
}

/** Miroir de `apps.programs.serializers.AssetSerializer` (`POST
 * /api/assets/`, ticket B-039/F-049) — `program` est l'id du `Program`
 * parent, vérifié appartenir à la même organisation cible côté backend
 * (`services.create_asset`), jamais ici. */
export interface Asset {
  id: string;
  name: string;
  program: string;
  created_at: string;
}

/** Miroir de `apps.programs.serializers.LotSerializer` en lecture (`POST
 * /api/lots/`, ticket B-039/F-049) — `asset` est l'id de l'`Asset` parent,
 * même principe que `Asset.program` ci-dessus. `surface` reste une chaîne
 * (format `DecimalField` DRF), jamais convertie en nombre côté frontend. */
export interface Lot {
  id: string;
  name: string;
  asset: string;
  assigned_organization: string | null;
  surface: string | null;
  created_at: string;
}

/** Miroir de `apps.procurement.serializers.LotSearchResultSerializer`
 * (`GET /api/procurement/admin/lots/?q=`, ticket B-028) — `organization`/
 * `program` imbriqués en id+name uniquement (jamais `asset`, pas nécessaire
 * pour `POST /api/procurement/devis/`). Les lots DÉJÀ verrouillés sont
 * exclus par le backend lui-même (`apps.procurement.services.
 * search_lots_as_admin`, décision D) — jamais un filtre reconstruit ici. */
export interface LotSearchResult {
  id: string;
  name: string;
  organization: { id: string; name: string };
  program: { id: string; name: string };
}

/**
 * Miroir de `apps.procurement.serializers.LotLedgerSerializer` (ticket
 * B-035) — grand-livre de coûts par lot (canal 1). `foncier_alloue`/
 * `be_alloue` sont un SNAPSHOT figé à la création (jamais recalculés,
 * même si `ProgramCost` change ensuite) — voir F-035-grand-livre-lot.md.
 * Ne porte PAS `construction_courante` ni les charges bureau de contrôle
 * (`LotBcCharge`, ticket B-036) : aucun des deux n'existe/n'est exposé par
 * l'API à ce jour, voir le même fichier pour la dépendance backend
 * transmise.
 */
export interface LotLedger {
  id: string;
  organization: string;
  lot: string;
  prix_client: string;
  foncier_alloue: string;
  be_alloue: string;
  created_by: string;
  created_at: string;
}

/**
 * Miroir de `apps.procurement.serializers.LotBcChargeSerializer` (ticket
 * B-036) — charge bureau de contrôle, effet de bord de chaque
 * `InspectionMission` créée sur ce lot. S'accumule INDÉPENDAMMENT de
 * l'existence d'un `LotLedger` (voir `apps/procurement/models.py::
 * LotBcCharge`, FK directe vers `Lot`, jamais vers `LotLedger`) — déjà
 * intégrée à la marge disponible (`GET .../margin/`), mais son montant
 * individuel n'était jamais visible avant ce ticket F-035. `jalon_type`
 * reste une référence LIBRE (jamais une FK), affichée telle quelle,
 * jamais réinterprétée.
 */
export interface LotBcCharge {
  id: string;
  organization: string;
  lot: string;
  mission: string;
  jalon_type: string;
  montant: string;
  is_global_reference: boolean;
  created_by: string;
  created_at: string;
}

/**
 * Miroir de la réponse JSON de `GET /api/procurement/lot-ledgers/
 * {lot_id}/margin/`, ÉTENDUE par le ticket B-038 (`apps.procurement.
 * services._compute_lot_ledger_margin_breakdown`) — remplace l'ancien
 * type inline `{ margin: string }` (F-035/F-035 bis, seul champ exposé
 * avant B-038). `margin = prix_client - foncier_alloue - be_alloue -
 * construction_courante - bc_charges_total`, déjà calculé côté backend —
 * ce ticket (F-037) affiche ces 6 valeurs telles quelles, aucun calcul
 * frontend. `construction_courante`/`bc_charges_total` n'existent NULLE
 * PART ailleurs dans ce projet (jamais exposés isolément avant B-038).
 */
export interface LotLedgerMarginBreakdown {
  prix_client: string;
  foncier_alloue: string;
  be_alloue: string;
  construction_courante: string;
  bc_charges_total: string;
  margin: string;
}

/** Vocabulaire de doctrine fixe (`apps.pricing.models.PricingCanal`, ticket
 * 025-backend) — les DEUX canaux existent partout, seul leur TAUX varie par
 * pays (`PricingConfig.country_pack`). Sans risque à coder en dur ici, même
 * raisonnement que `DevisStatus` ci-dessus : ce n'est PAS une configuration
 * `CountryPack`, c'est un vocabulaire fixe au même titre que `TrustLevel`. */
export type PricingCanal = 'canal_1_marge' | 'canal_2_commission';

/** Miroir de `apps.pricing.serializers.PricingConfigSerializer` — seule
 * audience possible : `admin_keyimmo` (ticket 025-backend, décision B).
 * `rate` est un POURCENTAGE (`max_digits=5`), jamais un montant — voir
 * `apps.procurement.services._derive_marge_estimee` (ticket 026-backend)
 * pour le seul consommateur métier de ce taux dans ce projet. */
export interface PricingConfig {
  id: string;
  country_pack: string;
  canal: PricingCanal;
  rate: string;
  created_by: string;
  created_at: string;
}

/** Réponse de `GET /api/pricing/configs/current/?country_pack_id=` (ticket
 * 025-backend) — un `PricingConfig` par canal, `null` si aucun taux n'a
 * encore été configuré pour ce `(country_pack, canal)`, jamais un champ
 * manquant du tout (les deux clés sont TOUJOURS présentes). */
export interface CurrentPricingRates {
  canal_1_marge: PricingConfig | null;
  canal_2_commission: PricingConfig | null;
}

/** Miroir de `apps.organizations.serializers.CountryPackListSerializer`
 * (`GET /api/organizations/country-packs/`, ticket B-030) — UNIQUEMENT les
 * `CountryPack` `is_active=True` (filtré côté backend, jamais recalculé
 * ici). `is_active` lui-même n'est pas exposé : tout élément listé EST
 * actif par construction du filtre backend. Aucun paramètre de recherche
 * côté serveur (liste complète) — voir `CountryPackSelector.tsx` pour le
 * filtrage textuel, purement client, sur cette liste déjà réduite. */
export interface CountryPackSummary {
  id: string;
  label: string;
  code: string;
}

/** Miroir de `apps.pricing.serializers.LegalPaymentTierStepSerializer`
 * (ticket B-027) — l'ordre d'affichage vient TOUJOURS du backend
 * (`LegalPaymentTierStep.Meta.ordering = ['order']`), jamais retrié ici. */
export interface LegalPaymentTierStep {
  id: string;
  order: number;
  code: string;
  label: string;
  cumulative_cap_percent: string;
  allows_progressive_payments: boolean;
}

/** Un palier en ENTRÉE de `POST /api/pricing/legal-payment-tier-templates/`
 * — mêmes champs que `LegalPaymentTierStep`, sans `id` (pas encore créé).
 * Peut être envoyé dans n'importe quel ordre (le backend trie lui-même par
 * `order` pour valider les plafonds cumulés, voir
 * `apps.pricing.services.create_legal_payment_tier_template`). */
export interface LegalPaymentTierStepInput {
  order: number;
  code: string;
  label: string;
  cumulative_cap_percent: string;
  allows_progressive_payments: boolean;
}

/** Miroir de `apps.pricing.serializers.LegalPaymentTierTemplateSerializer`
 * (ticket B-027) — seule audience possible : `admin_keyimmo`.
 *
 * **`activated_by`/`activated_at` signifient « a été activé un jour »,
 * PAS « est l'actif COURANT »** — posés UNE FOIS par
 * `activate_legal_payment_tier_template` (décision D) et JAMAIS effacés
 * quand un template plus récent prend sa place (l'ancien actif n'est
 * jamais modifié). Pour savoir quel template est actuellement actif pour
 * un pays, il faut `GET /api/pricing/legal-payment-tier-templates/active/`
 * (le pointeur `ActiveLegalPaymentTierTemplate`), jamais trier l'historique
 * sur `activated_at` — un brouillon jamais activé porte `null` pour les
 * deux champs. */
export interface LegalPaymentTierTemplate {
  id: string;
  country_pack: string;
  version: number;
  created_by: string;
  created_at: string;
  activated_by: string | null;
  activated_at: string | null;
  steps: LegalPaymentTierStep[];
}
