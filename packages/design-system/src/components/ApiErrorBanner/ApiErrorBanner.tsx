import { AlertBanner } from '../AlertBanner/AlertBanner';
import { isForbiddenError } from '../../errors/isForbiddenError';

export interface ApiErrorBannerProps {
  /** La valeur brute reçue par un `catch`/`ResourceState<T>` — jamais
   * présumée être une `ApiError` d'une app en particulier (voir
   * `isForbiddenError`). */
  error: unknown;
  /** Titre affiché pour toute erreur QUI N'EST PAS un 403 (message
   * générique existant à chaque site, inchangé). */
  title: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Ticket F-033 (vague 4) — un 403 (session valide, permission refusée pour
 * CETTE ressource) tombait dans le même message générique « Impossible de
 * charger X. » + bouton Réessayer que toute autre erreur de chargement,
 * alors que réessayer un 403 échoue à nouveau à l'identique. PAS un 401 :
 * un 401 est traité séparément et automatiquement (déconnexion, voir
 * `ApiClientConfig.onUnauthorized` de chaque app) — ce composant ne gère
 * que l'état visible pendant que la session reste valide.
 *
 * Wrapper fin autour d'`AlertBanner` (jamais une redéfinition) : ~19 sites
 * de ce projet rendaient exactement `<AlertBanner title="..." onRetry=.../>`
 * sur une erreur générique — ce composant centralise le SEUL branchement
 * qui diffère (403 ou non), le reste (titre contextuel par site) reste
 * inchangé.
 */
export function ApiErrorBanner({
  error, title, onRetry, retryLabel,
}: ApiErrorBannerProps) {
  if (isForbiddenError(error)) {
    return (
      <AlertBanner title="Accès refusé">
        Vous n&apos;avez pas les droits nécessaires pour accéder à cette ressource.
      </AlertBanner>
    );
  }
  return <AlertBanner title={title} onRetry={onRetry} retryLabel={retryLabel} />;
}
