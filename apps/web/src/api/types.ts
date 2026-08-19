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
