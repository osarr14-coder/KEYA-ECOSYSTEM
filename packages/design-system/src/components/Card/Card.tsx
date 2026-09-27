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
 *
 * Ticket F-055 (suite) — `--keya-shadow-sm` → `-md` : retour utilisateur
 * explicite (« la carte manque de présence »), après que le canevas de
 * page (`body`, `GlobalStyles.tsx`) soit passé de `neutral.surface` à
 * `neutral.background` (teinté) — `Card` doit se détacher plus nettement
 * de ce nouveau fond, `-sm` ne suffisait plus.
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
  /** Ticket F-073 — surtitre en petites capitales or, au-dessus du titre. */
  eyebrow?: string;
  /** Ticket F-073 — action(s) alignée(s) à droite du titre (bouton, lien). */
  action?: ReactNode;
}

export function Card({
  icon, title, children, tone = 'neutral', className, 'aria-label': ariaLabel, 'data-testid': testId, eyebrow, action,
}: CardProps) {
  const iconColor = tone === 'accent' ? semanticColors.progress.fill : semanticColors.accent.text;
  const hasHeader = Boolean(title || eyebrow || action);

  return (
    <section
      className={className}
      aria-label={ariaLabel}
      data-testid={testId}
      style={{
        border: `1px solid ${semanticColors.neutral.border}`,
        // Ticket F-073 — cartes plus généreuses (rayon 20, marge interne
        // 24px, réduite sur petit écran) et ombre plus douce.
        borderRadius: '20px',
        background: semanticColors.neutral.surface,
        padding: 'clamp(16px, 3vw, 24px)',
        boxShadow: 'var(--keya-shadow-sm)',
      }}
    >
      {hasHeader && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexGrow: 1, minWidth: 0 }}>
            {eyebrow && (
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: semanticColors.accent.text,
                }}
              >
                {eyebrow}
              </span>
            )}
            {title && (
              <h2
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  margin: 0,
                  fontSize: '20px',
                }}
              >
                {icon && <Icon name={icon} size={20} color={iconColor} />}
                {title}
              </h2>
            )}
          </div>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
