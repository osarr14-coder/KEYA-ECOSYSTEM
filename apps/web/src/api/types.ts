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
