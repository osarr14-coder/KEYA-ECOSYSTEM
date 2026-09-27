import type { Me } from '../api/types';

/**
 * Ticket 021 — dérive TOUS les codes de rôle de l'utilisateur (une entrée
 * par membership), pas seulement celui de la PREMIÈRE organisation comme
 * `resolveRedirectApp`/l'App Switcher (ticket 019, qui gate des modules
 * ORG-SCOPÉS — BUILD/FINANCE/NOTARY — sur l'organisation ACTIVE). Le
 * back-office n'est pas org-scopé : `admin_keyimmo` est une capacité
 * TRANSVERSE à toutes les organisations d'un utilisateur, exactement le
 * même raisonnement que `IsAdminKeyimmo` côté backend
 * (`apps/backoffice/permissions.py`, ticket 011), qui vérifie le rôle dans
 * N'IMPORTE LAQUELLE des memberships plutôt que dans l'organisation active
 * de la requête. Un utilisateur dont la PREMIÈRE membership n'est pas
 * `admin_keyimmo` doit quand même voir le back-office s'il détient ce rôle
 * ailleurs — utiliser `resolveRedirectApp`/la première membership seule ici
 * aurait refusé l'accès à tort à un admin légitime.
 */
export function deriveAllRoleCodes(me: Me): string[] {
  return Array.from(new Set(me.memberships.map((membership) => membership.role_code)));
}

export const ADMIN_KEYIMMO_ROLE = 'admin_keyimmo';
export const GESTIONNAIRE_ADV_ROLE = 'gestionnaire_adv';
export const FINANCE_ROLE = 'finance';

/** Ticket F-065 — l'ADV fait partie de l'équipe KEYIMMO (décision
 * utilisateur, ticket B-047) : il entre dans `apps/web`, mais n'y voit que
 * ses onglets (`App.tsx`, `TAB_DEFINITIONS[].roles`). Même sémantique
 * « rôle dans N'IMPORTE LAQUELLE des memberships » que ci-dessus, et que
 * `IsAdminKeyimmoOrGestionnaireADV` côté backend. */
export function hasBackofficeAccess(me: Me): boolean {
  const roles = deriveAllRoleCodes(me);
  // Ticket F-068 — Finance aussi (équipe KEYIMMO), onglets restreints.
  return [ADMIN_KEYIMMO_ROLE, GESTIONNAIRE_ADV_ROLE, FINANCE_ROLE].some((role) => roles.includes(role));
}
