import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';
import { Icon, type IconName } from '../Icon/Icon';

/**
 * Ticket F-045 — conteneur de section générique (bordure + fond + icône de
 * repère), en réponse à un retour utilisateur explicite : les écrans
 * n'avaient jusqu'ici AUCUN regroupement visuel — chaque section
 * s'enchaînait en texte brut sur fond blanc (titre `<h2>` + contenu),
 * lisible mais visuellement plat. `Card` ne porte AUCUNE logique métier
 * (comme `AlertBanner`/`ProgressBar`) — un simple conteneur réutilisable
 * par toute vue des 4 apps.
 *
 * Volontairement DISTINCT d'`AlertBanner` : `AlertBanner` signale un
 * problème/état à traiter (fond ambre/rouge, `role="alert"`) ; `Card`
 * regroupe une section de contenu neutre — jamais utilisé pour une alerte
 * (qui reste `AlertBanner`), jamais l'inverse.
 *
 * Ticket F-053 (refonte visuelle) — `borderRadius` 10px→16px et
 * `boxShadow` (`--keya-shadow-sm`, `GlobalStyles.tsx`) ajoutés : la
 * bordure `semanticColors.neutral.border` reste INCHANGÉE (retour
 * utilisateur explicite : trop plat, mais retirer la bordure casserait le
 * critère d'acceptation déjà testé du ticket F-045 — « bordure ET fond
 * distincts du texte brut »). L'ombre ajoute la profondeur demandée sans
 * toucher ce contrat existant.
 */
export interface CardProps {
  icon?: IconName;
  title?: string;
  children: ReactNode;
  /** Repère de couleur optionnel sur l'icône/le titre — jamais sur le fond
   * entier (qui resterait confondu avec `AlertBanner`). `neutral` (défaut)
   * réutilise le ton encre déjà établi ; `accent` réutilise le vert de
   * progression existant (`semanticColors.progress.fill`), pour une section
   * qui rapporte un succès/une validation sans être une alerte. */
  tone?: 'neutral' | 'accent';
  className?: string;
  /** Passthrough — un `Card` remplace parfois un `<section aria-label>`
   * existant (repère de landmark déjà en place avant ce ticket), jamais
   * perdu silencieusement. */
  'aria-label'?: string;
  'data-testid'?: string;
}

export function Card({
  icon, title, children, tone = 'neutral', className, 'aria-label': ariaLabel, 'data-testid': testId,
}: CardProps) {
  const iconColor = tone === 'accent' ? semanticColors.progress.fill : semanticColors.neutral.textMuted;

  return (
    <section
      className={className}
      aria-label={ariaLabel}
      data-testid={testId}
      style={{
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '16px',
        background: semanticColors.neutral.surface,
        padding: '16px',
        boxShadow: 'var(--keya-shadow-sm)',
      }}
    >
      {title && (
        <h2
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: 0,
            marginBottom: '12px',
            fontSize: '15px',
          }}
        >
          {icon && <Icon name={icon} size={18} color={iconColor} />}
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
