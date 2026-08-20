/**
 * Ticket F-033 (vague 4) — un 403 (authentification valide, permission
 * refusée) tombait dans le même message générique « Impossible de charger
 * X. » + bouton Réessayer que toute autre erreur de chargement, alors que
 * réessayer un 403 échoue à nouveau à l'identique (aucune donnée réseau
 * n'a changé, seul le droit d'accès manque) — trompeur pour l'utilisateur.
 *
 * Duck-typé sur `status` plutôt qu'un `instanceof` : chaque app de ce
 * monorepo a sa PROPRE classe `ApiError` (même discipline que
 * `createApiClient`, jamais partagée), toutes structurellement identiques
 * (`status: number`). Un helper structurel évite de dupliquer cette
 * vérification dans chaque app tout en restant correct face à N'IMPORTE
 * laquelle de ces classes.
 *
 * PAS un 401 : un 401 (authentification invalide/expirée) est traité
 * séparément, de façon centrale, par `ApiClientConfig.onUnauthorized`
 * (déconnexion automatique) — jamais par ce helper, qui ne concerne que
 * l'affichage d'un état visible pendant que la session reste valide.
 */
export function isForbiddenError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status: unknown }).status === 403
  );
}
