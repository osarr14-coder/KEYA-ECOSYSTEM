/**
 * Types miroir des payloads JSON du backend (`apps/build`, `apps/programs`,
 * `apps/accounts` côté Django) — snake_case, exactement ce que l'API
 * renvoie. Comme `apps/home` (ticket 008), aucun champ ici n'est recalculé,
 * seulement nommé.
 */

import type { TrustLevel } from '@keya/design-system';

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
  added_by_email: string;
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
  progress_percentage: number;
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
