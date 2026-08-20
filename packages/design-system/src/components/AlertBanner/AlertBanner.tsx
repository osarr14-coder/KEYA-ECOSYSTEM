import type { ReactNode } from 'react';

import { semanticColors } from '../../tokens/colors';

/**
 * Bandeau d'alerte générique — couleur + icône, pour qu'un problème
 * ressorte sans lecture attentive du texte (ticket 008 : le bandeau de
 * réserve ouverte de HOME en a besoin, mais ce composant n'a aucune
 * connaissance de `Reserve` ni d'aucun domaine métier — réutilisable par
 * tout futur écran, ex : exceptions du Control Tower BUILD, ticket 009).
 *
 * Volontairement distinct de `StatusBadge` : une alerte opérationnelle
 * n'est PAS un des 5 niveaux Visible Trust (voir CLAUDE.md, section
 * Inspections/Reserve — une réserve ouverte n'a pas de `TrustLevel` propre,
 * son statut se dérive de `source`). Réutiliser StatusBadge ici aurait
 * laissé croire, à tort, qu'un bandeau de réserve EST un niveau de
 * confiance — d'où un composant séparé, qui ne partage que les tokens de
 * couleur, jamais la forme/le vocabulaire de StatusBadge.
 */
export interface AlertBannerProps {
  title: string;
  children?: ReactNode;
  className?: string;
  /**
   * Ticket F-033 (vague 3) — redéclenche l'action associée (typiquement un
   * nouveau fetch) sans recharger la page ni changer un filtre. Absent par
   * défaut, volontairement : la plupart des usages d'`AlertBanner` ne sont
   * PAS des erreurs de chargement génériques (erreurs de soumission de
   * formulaire déjà retentables via leur propre bouton, bandeaux
   * informationnels, permission refusée où réessayer ne change rien...) —
   * ne poser cette prop que sur les cas réellement concernés.
   */
  onRetry?: () => void;
  retryLabel?: string;
}

function WarningIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M10 2 18.5 17H1.5z"
        fill="none"
        stroke={semanticColors.alert.icon}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <rect x="9.25" y="7.5" width="1.5" height="5" fill={semanticColors.alert.icon} />
      <rect x="9.25" y="13.5" width="1.5" height="1.5" fill={semanticColors.alert.icon} />
    </svg>
  );
}

export function AlertBanner({
  title, children, className, onRetry, retryLabel,
}: AlertBannerProps) {
  return (
    <div
      role="alert"
      className={className}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        background: semanticColors.alert.background,
        border: `1px solid ${semanticColors.alert.border}`,
        borderRadius: '8px',
        padding: '12px',
        color: semanticColors.alert.text,
      }}
    >
      <WarningIcon />
      <div>
        <strong>{title}</strong>
        {children && <div>{children}</div>}
        {onRetry && (
          <div style={{ marginTop: '8px' }}>
            <button type="button" onClick={onRetry}>{retryLabel ?? 'Réessayer'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
