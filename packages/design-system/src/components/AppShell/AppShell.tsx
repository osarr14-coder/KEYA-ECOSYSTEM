import { type ReactNode, useState } from 'react';

import { semanticColors } from '../../tokens/colors';
import { type Density, densityTokens } from '../../tokens/density';

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
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
          style={{
            width: '100%', padding: tokens.paddingBlock, border: 'none', background: 'transparent',
          }}
        >
          {collapsed ? '»' : '«'}
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
                      display: 'block',
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
                      borderLeft: isActive
                        ? `3px solid ${semanticColors.neutral.text}`
                        : '3px solid transparent',
                      fontWeight: isActive ? 600 : 400,
                      background: isActive ? semanticColors.neutral.background : 'transparent',
                    }}
                  >
                    {collapsed ? module.label.slice(0, 1) : module.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.gap,
          padding: `${tokens.paddingBlock} ${tokens.paddingInline}`,
          borderBottom: `1px solid ${semanticColors.neutral.border}`,
        }}
      >
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

        <a href="/tasks" aria-label={`Task Inbox — ${taskInboxCount} en attente`} style={{ marginLeft: 'auto' }}>
          🔔 <span data-testid="task-inbox-count">{taskInboxCount}</span>
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
