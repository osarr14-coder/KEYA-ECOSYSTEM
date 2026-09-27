import { semanticColors } from '../../tokens/colors';
import { Icon, type IconName } from '../Icon/Icon';

/**
 * Ticket 023 (polish visuel) — extrait des barres d'onglets dupliquées et
 * codées en dur indépendamment dans `apps/home/src/App.tsx` et
 * `apps/build/src/App.tsx` (même structure `<nav><button aria-current>`,
 * copiée-collée sans aucun style d'état actif nulle part : `aria-current`
 * était posé pour l'accessibilité, mais RIEN ne distinguait visuellement
 * l'onglet actif des autres, dans les deux apps). Composant purement
 * présentationnel — reçoit des ids/labels et un callback, ne connaît aucune
 * logique métier des vues qu'il bascule.
 */
export interface TabBarTab {
  id: string;
  label: string;
  /** Ticket F-045 — optionnel, jamais à la place du libellé (voir AppShell). */
  icon?: IconName;
}

export interface TabBarProps {
  tabs: TabBarTab[];
  activeTabId: string;
  onChange: (tabId: string) => void;
  'aria-label': string;
}

export function TabBar({ tabs, activeTabId, onChange, 'aria-label': ariaLabel }: TabBarProps) {
  return (
    <nav
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: '4px',
        borderBottom: `1px solid ${semanticColors.neutral.border}`,
        marginBottom: '16px',
        // Ticket F-070 — beaucoup d'onglets : défilement horizontal de la
        // barre, jamais un élargissement de la page ni des libellés cassés
        // sur 4 lignes.
        overflowX: 'auto',
        // Barre de défilement fine : sous Windows, celle par défaut
        // (épaisse, avec flèches) écrasait visuellement les onglets.
        scrollbarWidth: 'thin',
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(tab.id)}
            className="keya-tab"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              border: 'none',
              // Ticket F-073 — repère actif en or (token sémantique
              // `accent`, thémé) + graisse ; texte principal pour tous.
              borderBottom: isActive ? `3px solid ${semanticColors.accent.solid}` : '3px solid transparent',
              background: 'transparent',
              fontSize: '15px',
              fontWeight: isActive ? 700 : 500,
              color: isActive ? semanticColors.neutral.heading : semanticColors.neutral.text,
            }}
          >
            {tab.icon && <Icon name={tab.icon} size={16} />}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
