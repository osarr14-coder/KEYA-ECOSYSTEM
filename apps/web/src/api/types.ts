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
/** Audit UI R1 (R02) — événement du journal, lecture seule (admin). */
export interface JournalEntry {
  id: number;
  created_at: string;
  organization: string;
  actor: string | null;
  action: string;
  object_type: string;
  object_id: string;
  justification: string;
}

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
  commercial_status: LotCommercialStatus;
  sale_price: string | null;
  created_at: string;
}

/** Miroir de `apps.programs.models.LotCommercialStatus` (ticket B-042) —
 * disponibilité commerciale, distincte de l'avancement de chantier
 * (`TrustLevel`), jamais affichée avec `StatusBadge`. */
export type LotCommercialStatus = 'disponible' | 'reserve' | 'vendu';

/** Miroir de `apps.programs.serializers.CommercialLotSearchResultSerializer`
 * (`GET /api/programs/admin/lots/?q=`, ticket F-064) — contrairement à
 * `LotSearchResult` (recherche des devis), inclut les lots dont le devis est
 * verrouillé, et porte l'état commercial courant. `sale_price`/`surface`
 * restent des chaînes (format `DecimalField` DRF), jamais converties. */
export interface CommercialLot {
  id: string;
  name: string;
  surface: string | null;
  commercial_status: LotCommercialStatus;
  sale_price: string | null;
  organization: { id: string; name: string };
  program: { id: string; name: string };
  asset: { id: string; name: string };
}

/** Miroir de `apps.programs.serializers.ProgramRequestSerializer`
 * (`GET/POST /api/programs/requests/`, ticket B-042/F-058). `status`
 * n'est PAS un `TrustLevel` — même distinction que `Devis.status`
 * (ticket 022), jamais `StatusBadge`. `program` reste `null` tant
 * qu'`admin_keyimmo` n'a pas créé le `Program` séparément via le wizard
 * existant (`ProgramsView.tsx`) — cet écran ne le crée jamais lui-même
 * (verrou B-039 intact). */
export interface ProgramRequest {
  id: string;
  organization: string;
  organization_name: string;
  requested_by: string;
  /** PO-2026-09-28-22 : « organisation · rôle ». */
  requested_by_label: string;
  description: string;
  status: 'en_attente' | 'acceptee' | 'refusee';
  program: string | null;
  created_at: string;
}

/** Miroir de `apps.tasks.serializers` (ticket 006) — même forme que
 * `apps/home/src/api/types.ts::Task` (F-060 : câblage du compteur
 * `taskInboxCount` d'`AppShell`). `organization` (ticket B-044) :
 * `apps/web` est réservée à `admin_keyimmo` — TOUJOURS l'organisation
 * CIBLE d'une tâche (`devis_ajustement_refuse`/`lot_ledger_margin_
 * negative`, jamais celle de KEIMMO), transmise à `completeMyInboxTask`
 * (`api/client.ts`) pour la bascule RLS côté backend. */
export interface Task {
  id: string;
  organization: string;
  type: 'task' | 'notification' | 'alert' | 'exception';
  subject_type: string;
  subject_id: string;
  program: string | null;
  assignee: string;
  source: string;
  label: string;
  due_date: string | null;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'done';
  created_at: string;
  completed_at: string | null;
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
  /** PO-2026-09-28-03 : l'appel de ce palier n'est émissible qu'après
   * acceptation technique du jalon de même code (jamais le premier). */
  requires_technical_acceptance?: boolean;
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

/** Miroir de `apps.sales.models.ReservationStatus` (ticket B-048, CDC V3
 * §6.1). `reserved`/`committed` ne sont atteints qu'avec les encaissements
 * simulés (Phase 3). */
export type ReservationStatus = 'requested' | 'held' | 'reserved' | 'committed' | 'expired' | 'cancelled';

/** Miroir de `apps.sales.serializers.AdminReservationSerializer` (`GET
 * /api/reservations/admin/`, ticket B-048). Montants en chaîne (format
 * `DecimalField` DRF), jamais convertis. */
export interface AdminReservation {
  id: string;
  status: ReservationStatus;
  status_label: string;
  held_until: string;
  price_amount: string;
  currency: string;
  lot: { id: string; name: string; surface: string | null };
  program: { id: string; name: string };
  organization: { id: string; name: string };
  /** PO-2026-09-28-22 : le client est identifié par son nom fictif, jamais par son e-mail. */
  client: { id: string; full_name: string; role: string; /** PO-2026-09-28-34 : « Nom fictif · Client(e) ». */ label?: string };
  /** PO-2026-09-28-27 : jauge compacte du chantier du lot (calculée par le serveur). */
  worksite?: WorksiteGauge | null;
  cancellation_reason: string;
  cancelled_by: string | null;
  /** Ticket F-071 (backend B-056) — validation du dossier par l'ADV. */
  validated_at?: string | null;
  validated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractStatus = 'draft' | 'review' | 'approved' | 'signed_simulated';

export type ContractAction = 'submit' | 'back_to_draft' | 'approve';

/** Miroir de `apps.sales.serializers.ContractVersionSerializer` (ticket
 * B-049). `simulation` est toujours vrai : l'acte est fictif (CDC §3.1). */
export interface ContractVersion {
  id: string;
  reservation: string;
  lot_name: string;
  version: number;
  status: ContractStatus;
  status_label: string;
  content: string;
  authored_by: string;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  signed_at: string | null;
  simulation: boolean;
  created_at: string;
  updated_at: string;
}


// ─── Ticket F-068 — appels de fonds, encaissements, décaissements (B-050/51/52) ──

export type PaymentCallKind = 'frais' | 'premier_versement' | 'versement';
export type Settlement = 'to_pay' | 'partial' | 'settled';

/** Miroir de `apps.sales.serializers.PaymentCallSerializer`. Montants en
 * chaîne, jamais recalculés côté frontend. */
export interface PaymentCall {
  id: string;
  reservation: string;
  kind: PaymentCallKind;
  kind_label: string;
  tier_code: string;
  tier_label: string;
  cumulative_cap_percent: string | null;
  amount: string;
  currency: string;
  issued_by: string;
  issued_at: string;
  allocated_amount: string | null;
  settled_amount: string | null;
  settlement: Settlement | null;
}

export interface PaymentCallCandidate {
  kind: PaymentCallKind;
  kind_label: string;
  tier_code: string;
  tier_label: string;
  cumulative_cap_percent: string | null;
  amount: string;
  available: boolean;
  reason: string | null;
}

export interface TeamPaymentCalls {
  calls: PaymentCall[];
  candidates: PaymentCallCandidate[];
  blocking_reason: string | null;
}

export type FlowStatus = 'bank_executed_sim' | 'reconciled_sim';

export interface CustomerReceipt {
  id: string;
  bank_reference: string;
  amount: string;
  currency: string;
  received_on: string;
  status: FlowStatus;
  status_label: string;
  recorded_by: string;
  recorded_at: string;
  reconciled_by: string | null;
  reconciled_at: string | null;
  unallocated_amount: string | null;
  allocations: { id: string; payment_call: string; amount: string; created_at: string }[];
  simulation: boolean;
}

export interface FinanceFile {
  reservation: { id: string; status: ReservationStatus; status_label: string };
  calls: PaymentCall[];
  receipts: CustomerReceipt[];
}

export interface AccountBalance {
  received: string;
  executed: string;
  reserved: string;
  available: string;
  currency: string;
  simulation: boolean;
}

export interface ProgramAccountSummary {
  organization: { id: string; name: string };
  program: { id: string; name: string };
  balance: AccountBalance;
}

export type DisbursementStatus = 'draft' | 'eligible' | 'executed_sim' | 'cancelled';
export type DisbursementFlowStatus = 'planned' | 'bank_executed_sim' | 'beneficiary_confirmed_sim' | 'reconciled_sim';

/** Miroir de `apps.sales.serializers.DisbursementSerializer` (ticket
 * B-052). `beneficiary_confirmation: 'absent'` reste visible même après un
 * rapprochement motivé (CDC §8.3). */
export interface Disbursement {
  id: string;
  organization: { id: string; name: string };
  program: { id: string; name: string };
  lot: { id: string; name: string };
  milestone: { id: string; code: string; label: string };
  beneficiary_organization: { id: string; name: string };
  amount: string;
  currency: string;
  status: DisbursementStatus;
  status_label: string;
  flow_status: DisbursementFlowStatus;
  flow_status_label: string;
  bank_reference: string | null;
  executed_on: string | null;
  executed_at: string | null;
  executed_by: string | null;
  beneficiary_confirmation: 'confirmed' | 'absent' | null;
  beneficiary_confirmed_at: string | null;
  reconciled_at: string | null;
  reconciled_by: string | null;
  reconciliation_reason: string;
  cancel_reason: string;
  cancelled_at: string | null;
  eligible_at: string | null;
  prepared_by: string | null;
  created_at: string;
  simulation: boolean;
}

export interface AccountMilestone {
  id: string;
  code: string;
  label: string;
  order: number;
  lot: { id: string; name: string };
  beneficiary_organization: { id: string; name: string };
  disbursable: boolean;
  blockers: string[];
  open_disbursement: string | null;
}

export interface ProgramAccount extends ProgramAccountSummary {
  milestones: AccountMilestone[];
  disbursements: Disbursement[];
  /** Audit UI R1 (F03) — encaissements rapprochés qui composent « reçus ». */
  receipts?: AccountReceipt[];
}

export interface AccountReceipt {
  id: string;
  bank_reference: string;
  amount: string;
  currency: string;
  received_on: string;
  status_label: string;
  lot: string;
  client: string;
}

// ─── Ticket F-069 — contrôles à affecter (backend B-054) ────────────────────

/** Miroir de `apps.inspections.services.list_controls_to_assign`. */
export interface ControlToAssign {
  organization: { id: string; name: string };
  program: { id: string; name: string };
  lot: { id: string; name: string };
  milestone: { id: string; code: string; label: string };
  work_declaration_id: string;
  declared_at: string;
  status: 'awaiting_control' | 'under_reserve';
  status_label: string;
  evidence_count: number;
  latest_outcome: 'conforme' | 'avec_reserve' | null;
  correction_submitted: boolean;
  /** PO-2026-09-28-22 : contrôleur « organisation · rôle ». */
  pending_mission: { id: string; inspector: string; assigned_at: string } | null;
}

export interface InspectorSummary {
  id: string;
  /** PO-2026-09-28-22 : « organisation · rôle », jamais l'e-mail. */
  label: string;
  organizations: string[];
}

/** Ticket F-071 — miroir de `apps.sales.serializers.PaymentNoticeSerializer`
 * (backend B-056) : déclaration de virement du client, confirmée ou rejetée
 * par Finance. */
export interface PaymentNotice {
  id: string;
  organization: { id: string; name: string };
  program: { id: string; name: string };
  lot: { id: string; name: string };
  reservation: { id: string; status: ReservationStatus; status_label: string };
  /** PO-2026-09-28-22 : le client est identifié par son nom fictif, jamais par son e-mail. */
  client: { id: string; full_name: string; role: string; /** PO-2026-09-28-34 : « Nom fictif · Client(e) ». */ label?: string };
  payment_call: { id: string; kind: PaymentCallKind; kind_label: string; tier_label: string; amount: string };
  amount: string;
  currency: string;
  client_reference: string;
  paid_on: string;
  status: 'declared' | 'confirmed' | 'rejected';
  status_label: string;
  created_at: string;
  processed_by: string | null;
  processed_at: string | null;
  rejection_reason: string;
  simulation: boolean;
  /** Audit UI R1 (F01, F02) — encaissement simulé qui fait foi, une fois
   * le signalement traité par Finance. */
  receipt: PaymentNoticeReceipt | null;
  /** PO-2026-09-28-02 — encaissements déjà enregistrés sur le même dossier,
   * candidats au rattachement (vide une fois le signalement traité). */
  attachable_receipts?: { id: string; bank_reference: string; amount: string; currency: string; received_on: string }[];
}

/** PO-2026-09-28-01 — miroir de `apps.sales.serializers.FinanceReceiptSerializer`. */
export interface FinanceReceipt extends PaymentNoticeReceipt {
  simulation: boolean;
  organization_id: string;
  program: { id: string; name: string };
  lot: { id: string; name: string };
  reservation: { id: string; status: ReservationStatus; status_label: string };
  /** PO-2026-09-28-22 : le client est identifié par son nom fictif, jamais par son e-mail. */
  client: { id: string; full_name: string; role: string; /** PO-2026-09-28-34 : « Nom fictif · Client(e) ». */ label?: string };
  notices: { id: string; client_reference: string; status: PaymentNotice['status']; status_label: string }[];
}

export interface PaymentNoticeReceipt {
  id: string;
  bank_reference: string;
  amount: string;
  currency: string;
  received_on: string;
  status: 'bank_executed_sim' | 'reconciled_sim';
  status_label: string;
  recorded_by: string;
  recorded_at: string;
  reconciled_at: string | null;
  allocations: { id: string; payment_call: string; amount: string }[];
  unallocated_amount: string;
}

/** Ticket F-079 (backend B-057) — vitrine publique anonyme. */
export interface PublicProgram {
  id: string;
  name: string;
  /** PO-2026-09-27-13 : constructeur affecté (jamais « promoteur »). */
  constructeur: string;
  locations: string[];
  currency: string;
  lots: { id: string; name: string; asset: string; surface: string | null; price: string }[];
  total_lots: number;
  available_lots: number;
  price_from: string;
  payment_schedule: {
    reservation_fee: string;
    steps: { code: string; label: string; cumulative_cap_percent: string }[];
  };
}

export interface PublicWorksite {
  program: string;
  lot: string;
  location: string;
  accepted: number;
  total: number;
  milestones: { label: string; status: string; status_label: string }[];
}

/** PO-2026-09-28-27 — jauge compacte d'un lot (liste des dossiers du gestionnaire). */
export interface WorksiteGauge {
  milestones: { order: number; code: string; label: string; cdc_state: string; status_label: string; open_reserve_count: number }[];
  accepted_milestone_count: number;
  milestone_count: number;
  next_step: string;
  next_actor: string;
  open_reserve_count: number;
}
