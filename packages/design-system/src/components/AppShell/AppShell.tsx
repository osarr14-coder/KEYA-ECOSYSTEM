import { Fragment, type ReactNode, useState } from 'react';

import { useIsMobile } from '../../hooks/useIsMobile';
import { useTheme } from '../../hooks/useTheme';
import { brandColors, semanticColors } from '../../tokens/colors';
import { type Density, densityTokens } from '../../tokens/density';
import { spacing } from '../../tokens/spacing';
import { typography } from '../../tokens/typography';
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
  /**
   * Ticket F-051 — audit UX : la sidebar n'avait qu'un seul niveau, aucun
   * regroupement possible, quel que soit le nombre de modules. `group`
   * reste OPTIONNEL et purement additif : sans lui (comportement de TOUTES
   * les apps avant ce ticket), rien ne change — liste plate, aucun
   * en-tête. Deux modules CONSÉCUTIFS du même `group` sont rendus sous un
   * en-tête commun (le texte du groupe) ; l'ordre du tableau `modules`
   * reste la seule source d'ordre — `AppShell` ne trie/regroupe JAMAIS par
   * lui-même, l'app consommatrice doit déjà lister les modules d'un même
   * groupe de façon contiguë. Masqué en mode replié (rail mobile/desktop) —
   * même discipline que les libellés de module eux-mêmes.
   */
  group?: string;
  /** Ticket F-073 — compteur optionnel affiché à droite du libellé (ex.
   * nombre d'éléments « À faire »). Masqué à 0 ou absent. */
  badge?: number;
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
   * Ticket F-073 — la barre latérale navy porte désormais l'identité sur
   * les 4 apps ; `brand` ne pose plus qu'un filet or sous la barre du haut
   * (plus de bandeau navy ni de second logo, qui faisaient doublon).
   */
  brand?: boolean;
  /**
   * Ticket F-048 — nom de l'app affiché sous « KEYIMMO AFRIC » dans le
   * bloc de marque en haut de la barre latérale. Optionnel — sans valeur,
   * aucune ligne vide.
   */
  appLabel?: string;
  modules: AppModule[];
  /** Rôles de l'utilisateur courant, utilisés pour filtrer les modules
   * professionnels — voir `AppModule.requiredRoles`. */
  userRoles: string[];
  breadcrumbs?: Breadcrumb[];
  taskInboxCount?: number;
  /**
   * Ticket F-061 — la cloche restait un lien mort (`href="/tasks"`, ticket
   * F-045) : aucune des 3 apps qui rendent `AppShell` n'a de VRAIE route
   * `/tasks` (jamais de routeur pour `apps/home`/`apps/build`, `apps/web`
   * n'avait pas encore ce chemin dans `TAB_ROUTES`) — une navigation
   * `<a href>` classique aurait rechargé la page en pure perte pour
   * `apps/home`/`apps/build` (aucune route à intercepter au chargement),
   * jamais silencieusement pour `apps/web` non plus (rechargement complet
   * évitable). Optionnel : sans handler, la cloche garde son comportement
   * `href` d'origine (rétrocompatible, aucune app n'est cassée si elle
   * n'est pas encore mise à jour) — avec handler, l'appelant décide de la
   * navigation en SPA (changement d'onglet local, jamais un second
   * mécanisme de routage recodé ici).
   */
  onTaskInboxClick?: () => void;
  /** Ticket F-065 — `false` masque la cloche pour un utilisateur qui n'a
   * aucune boîte de tâches dans cette app (ex. `gestionnaire_adv` dans
   * `apps/web`, dont la boîte transverse est réservée à `admin_keyimmo`) :
   * un compteur toujours à 0 menant vers un onglet interdit serait trompeur.
   * Défaut `true` : aucune app existante n'est modifiée. */
  showTaskInbox?: boolean;
  /** Ticket F-070 — bouton « Se déconnecter » dans la barre du haut.
   * Optionnel : sans handler, aucun bouton (rétrocompatible). */
  onLogout?: () => void;
  user?: AppShellUser;
  organizationOptions?: AppShellOrganizationOption[];
  activeOrganizationId?: string;
  onOrganizationChange?: (organizationId: string) => void;
  programOptions?: AppShellOrganizationOption[];
  activeProgramId?: string;
  onProgramChange?: (programId: string) => void;
  onSearch?: (query: string) => void;
  activeModuleId?: string;
  /**
   * Ticket F-073 — navigation UNIQUE par la barre latérale : avec ce
   * handler, un clic sur un module appelle `onModuleSelect(id)` sans
   * rechargement (navigation SPA décidée par l'app), exactement comme la
   * cloche avec `onTaskInboxClick`. Sans handler, le lien `href` garde son
   * comportement natif (rétrocompatible).
   */
  onModuleSelect?: (moduleId: string) => void;
  /** Ticket F-073 — titre optionnel affiché dans la barre du haut (jamais
   * dérivé automatiquement du module actif : le libellé figurerait deux
   * fois dans la page). */
  title?: string;
  children?: ReactNode;
}

function isModuleVisible(module: AppModule, userRoles: string[]): boolean {
  if (!module.requiredRoles || module.requiredRoles.length === 0) return true;
  return module.requiredRoles.some((role) => userRoles.includes(role));
}

/**
 * Ticket F-053 — dégradé de la bande de marque. Ticket F-073 : porté par
 * TOUTE la barre latérale (pleine hauteur), sur les 4 apps. Exporté pour
 * les tests et pour les rares surfaces de marque hors AppShell (bandeau
 * CONTROL, écran de connexion, carte programme HOME).
 */
export const BRAND_GRADIENT = `linear-gradient(180deg, ${brandColors.navy} 0%, #071527 100%)`;

/** Ticket F-073 — or translucide de l'entrée active (≈ 18 % d'opacité). */
const ACTIVE_ITEM_BACKGROUND = 'rgba(196, 154, 44, 0.18)';
const SIDEBAR_TEXT = '#D5DCE8';
const SIDEBAR_TEXT_MUTED = 'rgba(213, 220, 232, 0.62)';

const chipStyle = {
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  minHeight: '40px',
  padding: '0 12px',
  borderRadius: '12px',
  background: semanticColors.neutral.subtle,
  color: semanticColors.neutral.text,
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
} as const;

export function AppShell({
  density,
  brand = false,
  appLabel,
  modules,
  userRoles,
  breadcrumbs = [],
  taskInboxCount = 0,
  onTaskInboxClick,
  showTaskInbox = true,
  onLogout,
  user,
  organizationOptions = [],
  activeOrganizationId,
  onOrganizationChange,
  programOptions = [],
  activeProgramId,
  onProgramChange,
  onSearch,
  activeModuleId,
  onModuleSelect,
  title,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Ticket F-050 — sous le seuil mobile, la barre latérale reste le rail
  // compact (icônes seules), quel que soit l'état `collapsed`.
  const isMobile = useIsMobile();
  const effectiveCollapsed = collapsed || isMobile;
  const { theme, setTheme } = useTheme();
  const tokens = densityTokens[density];
  const visibleModules = modules.filter((module) => isModuleVisible(module, userRoles));
  const headerTitle = title;

  return (
    <div
      data-testid="app-shell"
      data-density={density}
      style={{
        display: 'grid',
        // Ticket F-070 — `minmax(0, 1fr)` : jamais un élargissement au
        // contenu le plus large. Ticket F-073 : barre latérale plus large
        // (264px) pour des libellés entiers, rail de 64px.
        gridTemplateColumns: effectiveCollapsed ? '64px minmax(0, 1fr)' : '264px minmax(0, 1fr)',
        gridTemplateRows: 'auto 1fr',
        minHeight: 'calc(100vh - var(--keya-demo-banner-height, 0px))',
        fontSize: tokens.fontSize,
      }}
    >
      {/* Ticket F-073 (direction « Confiance premium », révision de la
          doctrine 17.3/F-048 validée par l'utilisateur) : la barre latérale
          ENTIÈRE est navy, pleine hauteur, sur les 4 apps et dans les deux
          thèmes — c'est le repère d'identité unique de KEYA. */}
      <aside
        aria-label="Navigation des modules"
        data-testid="app-shell-sidebar"
        style={{
          gridRow: '1 / span 2',
          background: BRAND_GRADIENT,
          color: SIDEBAR_TEXT,
          position: 'sticky',
          // Audit UI R1 (M01) : sous le bandeau de démonstration permanent.
          top: 'var(--keya-demo-banner-height, 0px)',
          height: 'calc(100vh - var(--keya-demo-banner-height, 0px))',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: spacing.md,
          paddingBottom: spacing.lg,
        }}
      >
        <div
          data-testid="sidebar-brand-block"
          style={{
            color: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: effectiveCollapsed ? '20px 8px 8px' : '24px 20px 8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: effectiveCollapsed ? 'center' : 'flex-start',
              gap: '12px',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: brandColors.gold,
                color: brandColors.navy,
                fontWeight: 600,
                fontSize: '15px',
                fontFamily: typography.headingFontFamily,
                flexShrink: 0,
              }}
            >
              K+
            </span>
            {!effectiveCollapsed && (
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontFamily: typography.headingFontFamily, fontSize: '18px', fontWeight: 600, lineHeight: 1.2 }}>
                  KEYIMMO AFRIC
                </span>
                {appLabel && (
                  <span style={{ fontSize: '12px', color: SIDEBAR_TEXT_MUTED, fontWeight: 500 }}>{appLabel}</span>
                )}
              </span>
            )}
          </div>
        </div>

        <nav style={{ padding: effectiveCollapsed ? '0 8px' : '0 12px' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {visibleModules.map((module, index) => {
              const isActive = module.id === activeModuleId;
              // Ticket F-051 — en-tête de groupe rendu une fois, à la
              // transition vers un `group` différent ; jamais en mode replié.
              const previousGroup = index > 0 ? visibleModules[index - 1].group : undefined;
              const showGroupHeader = Boolean(module.group) && module.group !== previousGroup && !effectiveCollapsed;
              const badge = module.badge && module.badge > 0 ? module.badge : undefined;
              return (
                <Fragment key={module.id}>
                  {/* Ticket F-051 — PAS aria-hidden : repère de section pour
                      tous, lecteurs d'écran compris. */}
                  {showGroupHeader && (
                    <li
                      style={{
                        padding: '16px 12px 6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        color: SIDEBAR_TEXT_MUTED,
                      }}
                    >
                      {module.group}
                    </li>
                  )}
                  <li>
                    <a
                      href={module.href}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={effectiveCollapsed ? module.label : undefined}
                      title={effectiveCollapsed ? module.label : undefined}
                      className="keya-nav-link"
                      onClick={onModuleSelect && ((event) => {
                        event.preventDefault();
                        onModuleSelect(module.id);
                      })}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: effectiveCollapsed ? 'center' : 'flex-start',
                        gap: '12px',
                        minHeight: '44px',
                        padding: effectiveCollapsed ? '0' : '0 12px',
                        borderRadius: '12px',
                        fontSize: '15px',
                        // Ticket F-073 — entrée active : fond or translucide,
                        // texte blanc en gras ET repère or à gauche (jamais la
                        // couleur seule, principe d'accessibilité du projet).
                        borderLeft: isActive ? `3px solid ${brandColors.gold}` : '3px solid transparent',
                        fontWeight: isActive ? 700 : 500,
                        background: isActive ? ACTIVE_ITEM_BACKGROUND : 'transparent',
                        color: isActive ? '#FFFFFF' : SIDEBAR_TEXT,
                        position: 'relative',
                      }}
                    >
                      {module.icon && <Icon name={module.icon} size={20} />}
                      {!effectiveCollapsed && <span style={{ flexGrow: 1, minWidth: 0 }}>{module.label}</span>}
                      {effectiveCollapsed && !module.icon && module.label.slice(0, 1)}
                      {badge !== undefined && (
                        <span
                          data-testid={`module-badge-${module.id}`}
                          aria-label={`${badge} en attente`}
                          style={{
                            ...(effectiveCollapsed ? { position: 'absolute', top: '4px', right: '4px' } : {}),
                            minWidth: '22px',
                            padding: '0 7px',
                            borderRadius: '999px',
                            background: brandColors.gold,
                            color: brandColors.navy,
                            fontSize: '12px',
                            fontWeight: 800,
                            lineHeight: '22px',
                            textAlign: 'center',
                          }}
                        >
                          {badge}
                        </span>
                      )}
                    </a>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </nav>

        {/* Ticket F-050 — rien à basculer sous le seuil mobile. */}
        {!isMobile && (
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
            style={{
              marginTop: 'auto',
              alignSelf: effectiveCollapsed ? 'center' : 'flex-start',
              marginInline: effectiveCollapsed ? 0 : '16px',
              width: '36px',
              height: '36px',
              border: 'none',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: SIDEBAR_TEXT,
            }}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={16} />
          </button>
        )}
      </aside>

      <header
        data-testid="app-shell-header"
        style={{
          position: 'sticky',
          top: 'var(--keya-demo-banner-height, 0px)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          minHeight: '64px',
          padding: isMobile ? '10px 16px' : '10px 40px',
          // Ticket F-039 — `brand` (HOME) : filet or sous la barre.
          borderBottom: brand ? `2px solid ${brandColors.gold}` : `1px solid ${semanticColors.neutral.border}`,
          background: semanticColors.neutral.surface,
        }}
      >
        {headerTitle && (
          <span
            data-testid="app-shell-title"
            style={{
              fontFamily: typography.headingFontFamily,
              fontSize: '20px',
              fontWeight: 600,
              color: semanticColors.neutral.heading,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {headerTitle}
          </span>
        )}
        {/* Ticket F-051 — recherche seulement si l'app la fournit. */}
        {onSearch && (
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              onSearch(String(formData.get('query') ?? ''));
            }}
          >
            <input type="search" name="query" aria-label="Rechercher" placeholder="Rechercher…" />
          </form>
        )}

        <span style={{ marginLeft: 'auto' }} />

        {organizationOptions.length > 0 && (
          <select
            aria-label="Organisation active"
            className="keya-select"
            value={activeOrganizationId}
            onChange={(event) => onOrganizationChange?.(event.target.value)}
            style={{ ...chipStyle, border: `1px solid ${semanticColors.neutral.border}`, background: semanticColors.neutral.surface, maxWidth: '260px' }}
          >
            {organizationOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        )}

        {programOptions.length > 0 && (
          <select
            aria-label="Programme actif"
            className="keya-select"
            value={activeProgramId}
            onChange={(event) => onProgramChange?.(event.target.value)}
            style={{ ...chipStyle, border: `1px solid ${semanticColors.neutral.border}`, background: semanticColors.neutral.surface, maxWidth: '260px' }}
          >
            {programOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        )}

        {showTaskInbox && (
          <a
            href="/tasks"
            onClick={onTaskInboxClick && ((event) => {
              event.preventDefault();
              onTaskInboxClick();
            })}
            aria-label={`Task Inbox — ${taskInboxCount} en attente`}
            style={chipStyle}
          >
            <Icon name="bell" size={18} />
            <span
              data-testid="task-inbox-count"
              style={taskInboxCount > 0 ? {
                minWidth: '20px',
                padding: '0 6px',
                borderRadius: '999px',
                background: semanticColors.accent.solid,
                color: semanticColors.accent.onSolid,
                fontSize: '12px',
                fontWeight: 800,
                lineHeight: '20px',
                textAlign: 'center',
              } : undefined}
            >
              {taskInboxCount}
            </span>
          </a>
        )}

        {user && (
          <span
            aria-label={`Connecté comme ${user.name}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: semanticColors.primary.background,
              color: semanticColors.primary.text,
              fontWeight: 700,
            }}
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} width={36} height={36} style={{ borderRadius: '50%' }} />
            ) : (
              <span aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
            )}
          </span>
        )}

        {/* Ticket F-051 — bascule binaire clair/sombre. */}
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-pressed={theme === 'dark'}
          aria-label={theme === 'dark' ? 'Désactiver le mode sombre' : 'Activer le mode sombre'}
          style={{ ...chipStyle, padding: '0 10px' }}
        >
          <Icon name="moon" size={18} />
        </button>

        {onLogout && (
          <button type="button" onClick={onLogout} style={chipStyle}>
            <Icon name="log-out" size={18} />
            {!isMobile && 'Se déconnecter'}
            {isMobile && <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Se déconnecter</span>}
          </button>
        )}
      </header>

      <main style={{ padding: isMobile ? '16px' : '32px 40px 48px', minWidth: 0 }}>
        {breadcrumbs.length > 0 && (
          <nav aria-label="Fil d'Ariane">
            <ol
              style={{
                display: 'flex',
                gap: tokens.gap,
                listStyle: 'none',
                padding: 0,
                margin: '0 0 16px 0',
                fontSize: '14px',
                color: semanticColors.neutral.textMuted,
              }}
            >
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
