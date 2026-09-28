/**
 * Types miroir des payloads JSON du backend (`apps/build`, `apps/programs`,
 * `apps/accounts` côté Django) — snake_case, exactement ce que l'API
 * renvoie. Comme `apps/home` (ticket 008), aucun champ ici n'est recalculé,
 * seulement nommé.
 */

import type { TrustLevel, TrustLevelEvidence, TrustLevelKey } from '@keya/design-system';

export interface ApiTrustEvent {
  level: TrustLevel;
  source: string;
  actor: string;
  scope: string;
  created_at: string;
}

export interface EvidenceSummary {
  id: string;
  milestone_label: string;
  created_at: string;
  /** Ticket 014 (friction du rapport bout-en-bout) : plusieurs preuves du
   * même jalon soumises le même jour sont sinon strictement indiscernables
   * dans le dropdown "Documenter une correction". */
  /** PO-2026-09-28-18 : « organisation · rôle », jamais l'e-mail. */
  added_by: string;
}

export interface LotExceptionRow {
  lot_id: string;
  lot_name: string;
  asset_name: string;
  program_name: string;
  label: string;
  reference_date?: string;
  work_declaration_id?: string;
}

export interface ReserveExceptionRow extends LotExceptionRow {
  reserve_id: string;
  /** PO-2026-09-28-07 (K02) : motif et action attendue de la réserve. */
  motif?: string;
  expected_action?: string;
  status: string;
  event: ApiTrustEvent;
  available_evidence: EvidenceSummary[];
}

export interface ExceptionsPayload {
  lots_en_retard: LotExceptionRow[];
  controles_a_planifier: LotExceptionRow[];
  capacites_manquantes: LotExceptionRow[];
  reserves_ouvertes: ReserveExceptionRow[];
  documents_manquants: LotExceptionRow[];
}

export interface LotRow {
  id: string;
  name: string;
  asset_name: string;
  program_id: string;
  program_name: string;
  assigned_organization_id: string | null;
  assigned_organization_name: string | null;
  milestone_count: number;
  declared_milestone_count: number;
  /** PO-2026-09-28-14 : jalons acceptés techniquement (compte, jamais un %). */
  accepted_milestone_count: number;
  /** PO-2026-09-28-27 : jauge compacte (états CDC du serveur), prochaine étape, qui agit. */
  milestones?: { order: number; code: string; label: string; cdc_state: string; status_label: string; open_reserve_count: number }[];
  next_step?: string;
  next_actor?: string;
  open_reserve_count: number;
  created_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface AllLotsQuery {
  ordering?: string;
  program?: string;
  assigned?: 'true' | 'false';
  q?: string;
  page?: number;
  page_size?: number;
}

export interface MeMembership {
  organization_id: string;
  organization_name: string;
  role_code: string;
  role_label: string;
}

export interface Me {
  id: string;
  email: string;
  full_name: string;
  memberships: MeMembership[];
}

/** Miroir de `apps.tasks.serializers` (`GET /api/me/tasks/`, ticket 006) —
 * même forme que `apps/home/src/api/types.ts::Task` (F-060 : câblage du
 * compteur `taskInboxCount` d'`AppShell`, resté à 0 par défaut jusqu'ici
 * dans cette app faute de tout consommateur de `/api/me/tasks/`). */
export interface Task {
  id: string;
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

/** Ticket F-068 — sortie simulée du compte d'un programme vers
 * l'organisation du constructeur (backend B-052, CDC V3 §8.2/§8.3). Miroir
 * partiel de `apps.sales.serializers.DisbursementSerializer`. */
export interface ReceivedDisbursement {
  id: string;
  organization: { id: string; name: string };
  program: { id: string; name: string };
  lot: { id: string; name: string };
  milestone: { id: string; code: string; label: string };
  amount: string;
  currency: string;
  flow_status: 'bank_executed_sim' | 'beneficiary_confirmed_sim' | 'reconciled_sim';
  flow_status_label: string;
  bank_reference: string | null;
  executed_on: string | null;
  beneficiary_confirmation: 'confirmed' | 'absent' | null;
  beneficiary_confirmed_at: string | null;
  reconciliation_reason: string;
  simulation: boolean;
}

export type MilestoneControlStatus =
  'not_declared' | 'awaiting_documents' | 'awaiting_control' | 'under_reserve' | 'accepted';

/** Ticket F-069 — miroir de `apps.build.services.lot_milestone_rows`
 * (B-054) : état toujours dérivé côté serveur, jamais recalculé ici. */
export interface LotMilestone {
  id: string;
  order: number;
  code: string;
  label: string;
  status: MilestoneControlStatus;
  /** Audit UI R1, étape 3 (A-DS-4) : état d'affichage du CDC §7.1, dérivé
   * côté serveur ; `status_label` porte son libellé. */
  cdc_state?: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CHANGES_REQUESTED' | 'RESUBMITTED' | 'TECHNICALLY_ACCEPTED';
  status_hint?: string;
  status_label: string;
  /** PO-2026-09-28-04 : preuve de chaque niveau atteint (qui, rôle, quand,
   * version examinée, périmètre) ; un niveau absent n'est pas atteint. */
  trust_levels?: Partial<Record<TrustLevelKey, TrustLevelEvidence>>;
  work_declaration_id: string | null;
  evidence_count: number;
  latest_outcome: 'conforme' | 'avec_reserve' | null;
  reserve_id: string | null;
  correction_submitted: boolean;
  control_scheduled: boolean;
  /** PO-2026-09-28-16 : réserves ouvertes du jalon (motif, action attendue,
   * date serveur, auteur « organisation · rôle »). */
  open_reserves?: MilestoneReserve[];
}

export interface MilestoneReserve {
  id: string;
  motif: string;
  expected_action: string;
  opened_at: string;
  opened_by: string;
  status: 'ouverte' | 'correction_proposee' | 'nouvelle_inspection' | 'maintenue' | string | null;
  status_label: string;
}
