import { ICON_PATHS, type IconName } from './paths';

export type { IconName } from './paths';

/**
 * Ticket F-045 — voir `paths.ts` pour la justification du choix (tracés
 * maison plutôt qu'une dépendance externe). Décoratif par défaut
 * (`aria-hidden`, cas majoritaire : une icône accompagne déjà un libellé
 * texte visible ailleurs dans le même contrôle) — passer `title` pour le
 * cas contraire (icône seule porteuse de sens, ex. un futur bouton
 * icône-seul), qui pose alors `role="img"` + `<title>` au lieu de
 * `aria-hidden`, jamais les deux à la fois (voir `ui-ux-pro-max`,
 * domaine `icons`, « decorative icon aria hidden » / « icon button
 * accessible label »).
 */
export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  title?: string;
  className?: string;
}

export function Icon({
  name, size = 20, color = 'currentColor', title, className,
}: IconProps) {
  const paths = ICON_PATHS[name];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
