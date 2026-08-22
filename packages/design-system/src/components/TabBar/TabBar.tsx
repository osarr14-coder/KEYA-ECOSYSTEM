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
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              border: 'none',
              borderBottom: isActive ? `2px solid ${semanticColors.neutral.text}` : '2px solid transparent',
              background: 'transparent',
              fontSize: 'inherit',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? semanticColors.neutral.text : semanticColors.neutral.textMuted,
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
