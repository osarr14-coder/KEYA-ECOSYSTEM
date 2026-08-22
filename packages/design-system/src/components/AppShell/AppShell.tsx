import { type ReactNode, useState } from 'react';

import { brandColors, semanticColors } from '../../tokens/colors';
import { type Density, densityTokens } from '../../tokens/density';
import { spacing } from '../../tokens/spacing';
import { Icon, type IconName } from '../Icon/Icon';

/**
 * Un module de la sidebar. `requiredRoles` est le mécanisme générique de
 * gating par rôle (ticket 007) : un module sans `requiredRoles` est toujours
 * visible (ex: Accueil) ; un module "professionnel" (BUILD, FINANCE, NOTARY)
 * n'apparaît que si `userRoles` contient au moins un des rôles listés. Ce
 * package ne connaît pas le vocabulaire RBAC exact du backend (ticket 001) —
 * c'est à l'app consommatrice de fournir les bons codes de rôle.
 */
export interface AppModule {
  id: string;
  label: string;
  href: string;
  requiredRoles?: string[];
  /** Ticket F-045 — repère visuel en plus du libellé (jamais à sa place :
   * un module sans `icon` retombe sur l'initiale du libellé, comportement
   * strictement inchangé). En mode replié, l'icône REMPLACE l'initiale
   * quand elle est fournie — plus lisible qu'une lettre seule à cette
   * densité. */
  icon?: IconName;
}

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface AppShellOrganizationOption {
  id: string;
  label: string;
}

export interface AppShellUser {
  name: string;
  avatarUrl?: string;
}

export interface AppShellProps {
  /** "dense" (BUILD/FINANCE) ou "confortable" (HOME) — un seul composant,
   * pas deux implémentations séparées (critère d'acceptation ticket 007). */
  density: Density;
  /**
   * Ticket F-039 — identité de marque KEYIMMO AFRIC (navy/or) sur le
   * "chrome" (en-tête). Volontairement un prop EXPLICITE, jamais dérivé de
   * `density === 'confortable'` : aujourd'hui seule HOME utilise cette
   * densité, mais coupler le rendu de marque à la densité créerait un
   * couplage implicite fragile — c'est à l'app consommatrice de le
   * demander explicitement, même principe que `requiredRoles`/`userRoles`.
   * Absent ou `false` : comportement strictement inchangé (BUILD/CONTROL/
   * apps/web, aucune régression possible).
   */
  brand?: boolean;
  /**
   * Ticket F-048 — révision LIMITÉE et PRÉCISE de la doctrine 17.3
   * (« brandColors réservé à HOME ») : nom de l'app affiché dans le
   * nouveau bloc navy TOUJOURS visible en haut de la sidebar (jamais
   * gated par `brand`, contrairement au bandeau `<header>` de F-039,
   * qui reste HOME-only et intouché). Optionnel — sans valeur, seule
   * la ligne « KEYIMMO AFRIC » s'affiche, pas de ligne vide.
   */
  appLabel?: string;
  modules: AppModule[];
  /** Rôles de l'utilisateur courant, utilisés pour filtrer les modules
   * professionnels — voir `AppModule.requiredRoles`. */
  userRoles: string[];
  breadcrumbs?: Breadcrumb[];
  taskInboxCount?: number;
  user?: AppShellUser;
  organizationOptions?: AppShellOrganizationOption[];
  activeOrganizationId?: string;
  onOrganizationChange?: (organizationId: string) => void;
  programOptions?: AppShellOrganizationOption[];
  activeProgramId?: string;
  onProgramChange?: (programId: string) => void;
  onSearch?: (query: string) => void;
  activeModuleId?: string;
  children?: ReactNode;
}

function isModuleVisible(module: AppModule, userRoles: string[]): boolean {
  if (!module.requiredRoles || module.requiredRoles.length === 0) return true;
  return module.requiredRoles.some((role) => userRoles.includes(role));
}

export function AppShell({
  density,
  brand = false,
  appLabel,
  modules,
  userRoles,
  breadcrumbs = [],
  taskInboxCount = 0,
  user,
  organizationOptions = [],
  activeOrganizationId,
  onOrganizationChange,
  programOptions = [],
  activeProgramId,
  onProgramChange,
  onSearch,
  activeModuleId,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const tokens = densityTokens[density];
  const visibleModules = modules.filter((module) => isModuleVisible(module, userRoles));

  return (
    <div
      data-testid="app-shell"
      data-density={density}
      style={{
        display: 'grid',
        gridTemplateColumns: collapsed ? '56px 1fr' : '220px 1fr',
        gridTemplateRows: 'auto 1fr',
        minHeight: '100vh',
        fontSize: tokens.fontSize,
      }}
    >
      <aside
        aria-label="Navigation des modules"
        style={{ gridRow: '1 / span 2', borderRight: `1px solid ${semanticColors.neutral.border}` }}
      >
        {/* Ticket F-048 — révision LIMITÉE et PRÉCISE de la doctrine 17.3 :
            TOUJOURS rendu, sur les 4 apps, indépendamment de `brand`
            (contrairement au bandeau `<header>` de F-039 ci-dessous, qui
            reste HOME-only et intouché). `data-testid` DISTINCT de
            `brand-mark` (bandeau) — les deux zones ne doivent jamais être
            confondues dans les tests. */}
        <div
          data-testid="sidebar-brand-block"
          style={{
            background: brandColors.navy,
            color: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: collapsed ? `${spacing.md} ${spacing.sm}` : `${spacing.md} ${spacing.lg}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: spacing.sm,
            }}
          >
            <span style={{ color: brandColors.gold, fontWeight: 700 }}>K+</span>
            {!collapsed && <span style={{ fontWeight: 700 }}>KEYIMMO AFRIC</span>}
          </div>
          {!collapsed && appLabel && (
            <span style={{ fontSize: '0.85em', color: 'rgba(255, 255, 255, 0.72)' }}>{appLabel}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
          style={{
            width: '100%',
            padding: tokens.paddingBlock,
            border: 'none',
            background: 'transparent',
            display: 'flex',
            justifyContent: 'center',
            color: semanticColors.neutral.textMuted,
          }}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={16} />
        </button>
        <nav>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visibleModules.map((module) => {
              const isActive = module.id === activeModuleId;
              return (
                <li key={module.id}>
                  <a
                    href={module.href}
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      gap: tokens.gap,
                      padding: `${tokens.paddingBlock} ${tokens.paddingInline}`,
                      fontSize: tokens.fontSize,
                      // Ticket 023 (polish visuel) — `aria-current` était déjà
                      // posé correctement (accessibilité), mais rien ne
                      // distinguait visuellement le module actif des autres :
                      // seul un lecteur d'écran pouvait "voir" la page
                      // courante. Bordure + poids de police, pas la couleur
                      // seule (accessibilité — ne jamais distinguer par la
                      // seule couleur, principe déjà respecté ailleurs dans
                      // ce projet, voir CLAUDE.md ticket 014).
                      // Ticket F-048 — SEULE la couleur de cette bordure
                      // change (`brandColors.gold`, doctrine 17.3 révisée
                      // de façon limitée) : fond/couleur de texte
                      // ci-dessous restent EXACTEMENT ceux d'avant ce
                      // ticket, décision confirmée explicitement.
                      borderLeft: isActive
                        ? `3px solid ${brandColors.gold}`
                        : '3px solid transparent',
                      fontWeight: isActive ? 600 : 400,
                      background: isActive ? semanticColors.neutral.background : 'transparent',
                      color: isActive ? semanticColors.neutral.text : semanticColors.neutral.textMuted,
                    }}
                  >
                    {module.icon && <Icon name={module.icon} size={18} />}
                    {!collapsed && module.label}
                    {collapsed && !module.icon && module.label.slice(0, 1)}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <header
        data-testid="app-shell-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.gap,
          padding: `${tokens.paddingBlock} ${tokens.paddingInline}`,
          borderBottom: brand ? `2px solid ${brandColors.gold}` : `1px solid ${semanticColors.neutral.border}`,
          background: brand ? brandColors.navy : undefined,
          color: brand ? '#FFFFFF' : undefined,
        }}
      >
        {brand && (
          // Ticket F-039 — aucun asset logo K+toit n'existe dans ce projet
          // (vérifié : recherche exhaustive de fichiers image, un seul
          // résultat trouvé, `apps/control-pwa/public/icon.svg`, un icône
          // générique sans lien avec KEYIMMO AFRIC) — repère de marque
          // textuel plutôt que de référencer un fichier qui n'existe pas.
          <span
            data-testid="brand-mark"
            style={{
              display: 'inline-flex', alignItems: 'baseline', gap: '4px', fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: brandColors.gold }}>K+</span>
            <span>KEYIMMO AFRIC</span>
          </span>
        )}
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            onSearch?.(String(formData.get('query') ?? ''));
          }}
        >
          <input type="search" name="query" aria-label="Rechercher" placeholder="Rechercher…" />
        </form>

        {organizationOptions.length > 0 && (
          <select
            aria-label="Organisation active"
            value={activeOrganizationId}
            onChange={(event) => onOrganizationChange?.(event.target.value)}
          >
            {organizationOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        )}

        {programOptions.length > 0 && (
          <select
            aria-label="Programme actif"
            value={activeProgramId}
            onChange={(event) => onProgramChange?.(event.target.value)}
          >
            {programOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        )}

        <a
          href="/tasks"
          aria-label={`Task Inbox — ${taskInboxCount} en attente`}
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px',
          }}
        >
          {/* Ticket F-045 — remplace l'emoji 🔔 (seul emoji du projet, jamais
              une icône) par l'icône trait maison, même famille que le reste. */}
          <Icon name="bell" size={18} />
          <span data-testid="task-inbox-count">{taskInboxCount}</span>
        </a>

        {user && (
          <span aria-label={`Connecté comme ${user.name}`}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} width={28} height={28} style={{ borderRadius: '50%' }} />
            ) : (
              <span aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
            )}
          </span>
        )}
      </header>

      <main style={{ padding: tokens.paddingInline }}>
        {breadcrumbs.length > 0 && (
          <nav aria-label="Fil d'Ariane">
            <ol style={{ display: 'flex', gap: tokens.gap, listStyle: 'none', padding: 0, margin: `0 0 ${tokens.gap} 0` }}>
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <li key={`${crumb.label}-${index}`}>
                    {crumb.href && !isLast ? <a href={crumb.href}>{crumb.label}</a> : <span aria-current={isLast ? 'page' : undefined}>{crumb.label}</span>}
                    {!isLast && <span aria-hidden="true"> / </span>}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        {children}
      </main>
    </div>
  );
}
