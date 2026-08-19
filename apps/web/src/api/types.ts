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
 * Tous les champs de relation (`organization`, `candidate_organization`,
 * `lot`, `logged_by`) sont des UUID bruts : aucun nom n'est résolu
 * côté backend (`ModelSerializer` par défaut, pas de champ imbriqué) —
 * limite documentée dans `F-027-devis-fonctionnel.md`, liée à l'absence
 * d'endpoint de recherche Lot/Organisation (ticket B-028, backend). */
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
