/**
 * Types miroir des payloads JSON du backend (`apps/home`, `apps/tasks`
 * côté Django) — snake_case, exactement ce que l'API renvoie. Rien ici
 * n'est recalculé : ce fichier ne fait que NOMMER la forme des données,
 * jamais en dériver une nouvelle valeur (voir `toTrustEventData` plus bas,
 * qui reformate des clés, ne calcule rien — critère d'acceptation ticket
 * 008 : « aucun calcul de pourcentage ou de statut dans le frontend »).
 */

import type { TrustEventData, TrustLevel } from '@keya/design-system';

export interface ApiTrustEvent {
  level: TrustLevel;
  source: string;
  actor: string;
  scope: string;
  created_at: string;
}

export interface MilestoneStatus {
  id: string;
  code: string;
  label: string;
  order: number;
  level: TrustLevel | null;
  event: ApiTrustEvent | null;
}

export interface OpenReserve {
  id: string;
  status: string;
  description: string;
}

export interface LotOverview {
  lot_id: string;
  lot_name: string;
  asset_name: string;
  asset_location: string;
  program_name: string;
  progress_percentage: number;
  milestones: MilestoneStatus[];
  latest_notable_event: ApiTrustEvent | null;
  open_reserve: OpenReserve | null;
}

export interface MyLot {
  id: string;
  name: string;
  asset_name: string;
  asset_location: string;
  program_name: string;
}

export interface EvidenceDocumentProvenance {
  category: string;
  source: string;
  captured_at: string | null;
}

export interface EvidenceFeedItem {
  id: string;
  milestone_code: string;
  milestone_label: string;
  added_by: string;
  created_at: string;
  document_count: number;
  documents: EvidenceDocumentProvenance[];
  status: ApiTrustEvent | null;
}

/** Ticket 019 — miroir de `apps.accounts.serializers.MembershipSummarySerializer`. */
export interface MeMembership {
  organization_id: string;
  organization_name: string;
  role_code: string;
  role_label: string;
}

/** Ticket 019 — miroir de `apps.accounts.serializers.MeSerializer`
 * (`GET /api/me/`) : TOUTES les memberships de l'utilisateur, pas
 * seulement celle de l'organisation active. */
export interface Me {
  id: string;
  email: string;
  full_name: string;
  memberships: MeMembership[];
}

/** Ticket F-057 — miroir de `apps.programs.serializers.
 * ProgramRequestSerializer` (`GET/POST /api/programs/requests/`). */
export interface ProgramRequest {
  id: string;
  organization: string;
  organization_name: string;
  requested_by: string;
  requested_by_email: string;
  description: string;
  status: 'en_attente' | 'acceptee' | 'refusee';
  program: string | null;
  created_at: string;
}

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

/**
 * Simple reformatage de clés (snake_case → camelCase attendu par
 * `StatusBadge` du design system) — AUCUNE valeur n'est calculée ou dérivée
 * ici, seule la forme change. C'est la même donnée que
 * `apps/trust/repository.py::get_current_status` a produite côté backend.
 */
export function toTrustEventData(event: ApiTrustEvent): TrustEventData {
  return {
    level: event.level,
    source: event.source,
    actor: event.actor,
    scope: event.scope,
    createdAt: event.created_at,
  };
}

/** Miroir de `apps.sales.serializers.CatalogLotSerializer` (`GET
 * /api/catalog/lots/`, ticket B-048). Montants en chaîne (`DecimalField`
 * DRF) : jamais d'arithmétique côté frontend, seulement de l'affichage. */
export interface CatalogLot {
  id: string;
  name: string;
  surface: string | null;
  sale_price: string;
  currency: string;
  organization: { id: string; name: string };
  program: { id: string; name: string };
  asset: { id: string; name: string; location: string };
}

/** Miroir de `apps.sales.models.ReservationStatus` (ticket B-048, CDC V3 §6.1).
 * `reserved`/`committed` ne sont atteints qu'avec les encaissements
 * simulés (Phase 3). */
export type ReservationStatus = 'requested' | 'held' | 'reserved' | 'committed' | 'expired' | 'cancelled';

/** Miroir de `apps.sales.serializers.ReservationSerializer`. */
export interface Reservation {
  id: string;
  status: ReservationStatus;
  status_label: string;
  held_until: string;
  price_amount: string;
  currency: string;
  lot: { id: string; name: string; surface: string | null };
  program: { id: string; name: string };
  organization: { id: string; name: string };
  cancellation_reason: string;
  created_at: string;
  updated_at: string;
}

export type ContractStatus = 'draft' | 'review' | 'approved' | 'signed_simulated';

/** Miroir de `apps.sales.serializers.ContractVersionSerializer` (ticket
 * B-049). Côté client, seules les versions approuvées ou signées sont
 * renvoyées. `simulation` est toujours vrai : l'acte est fictif (CDC §3.1). */
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

