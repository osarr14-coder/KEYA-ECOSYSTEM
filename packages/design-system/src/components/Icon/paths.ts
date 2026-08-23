/**
 * Ticket F-045 — bibliothèque d'icônes minimale, dessinée à la main plutôt
 * que via une dépendance externe (Phosphor/Heroicons) : ce monorepo n'a
 * jamais eu de dépendance d'icônes (voir `AlertBanner::WarningIcon`, seul
 * précédent, déjà inline) — ajouter un paquet npm pour ~15 tracés aurait
 * été disproportionné, et casserait la discipline « 100% inline React »
 * du projet (voir CLAUDE.md, ticket F-038). Style delibérément uniforme :
 * grille 24x24, trait seul (`fill="none"`, `stroke="currentColor"`),
 * `strokeWidth={1.75}`, extrémités/jonctions arrondies — même famille
 * visuelle que les icônes outline (Phosphor/Feather), jamais mélangée à
 * un style rempli (`fill`) ou à un emoji (voir remplacement de 🔔 dans
 * `AppShell`, même ticket).
 *
 * Un seul fichier de tracés bruts, séparé de `Icon.tsx` (le composant) —
 * ajouter une icône ne touche jamais au rendu/à l'API du composant.
 */

export type IconName =
  | 'home'
  | 'building'
  | 'clipboard-check'
  | 'file-text'
  | 'wallet'
  | 'shield-check'
  | 'bell'
  | 'search'
  | 'chevron-left'
  | 'chevron-right'
  | 'alert-triangle'
  | 'check-circle'
  | 'users'
  | 'camera'
  | 'scale'
  | 'moon';

/** Un `<path>` (ou plusieurs) par icône, déjà dans le repère 24x24 — le
 * composant `Icon` ne fait qu'entourer ces tracés d'un `<svg>` commun.
 */
export const ICON_PATHS: Record<IconName, string[]> = {
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9', 'M9.5 20v-6h5v6'],
  building: [
    'M4 20V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15',
    'M15 20v-8h4a1 1 0 0 1 1 1v7',
    'M7.5 7.5h1.5M11 7.5h1.5M7.5 11h1.5M11 11h1.5M7.5 14.5h1.5M11 14.5h1.5',
  ],
  'clipboard-check': [
    'M9 4.5h6a1 1 0 0 1 1 1V6h1.5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H8v-.5a1 1 0 0 1 1-1Z',
    'M9.5 13.5 11.5 15.5 15 11.5',
  ],
  'file-text': [
    'M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z',
    'M14 3.5V8h4',
    'M9 13h6M9 16.5h6',
  ],
  wallet: [
    'M3.5 7.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-10Z',
    'M15.5 12.5h3v2.5h-3a1.25 1.25 0 0 1 0-2.5Z',
    'M3.5 8.5 12 5l5 2.5',
  ],
  'shield-check': [
    'M12 3.5 19 6.3v5.4c0 4.4-3 7.9-7 8.8-4-.9-7-4.4-7-8.8V6.3L12 3.5Z',
    'M9 12l2.2 2.2L15.5 9.7',
  ],
  bell: [
    'M6.5 10.5a5.5 5.5 0 0 1 11 0v3.3l1.4 2.4a.8.8 0 0 1-.7 1.2H5.8a.8.8 0 0 1-.7-1.2l1.4-2.4v-3.3Z',
    'M10 19.5a2 2 0 0 0 4 0',
  ],
  search: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M16 16l4.5 4.5'],
  'chevron-left': ['M14.5 5 8 12l6.5 7'],
  'chevron-right': ['M9.5 5 16 12l-6.5 7'],
  'alert-triangle': ['M12 3.5 21.5 20h-19L12 3.5Z', 'M12 9.5v4.5', 'M12 17v.01'],
  'check-circle': ['M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z', 'M8.5 12.3l2.4 2.4 4.6-5.4'],
  users: [
    'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M3.5 19.5c.6-3 2.6-4.8 5-4.8s4.4 1.8 5 4.8',
    'M16 5.3a3 3 0 0 1 0 5.8',
    'M15.5 14.7c1.9.4 3.3 2 3.8 4.3',
  ],
  camera: [
    'M4 8.5a1 1 0 0 1 1-1h2.2l1-1.6a1 1 0 0 1 .86-.4h5.9a1 1 0 0 1 .85.4l1 1.6H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z',
    'M12 16a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Z',
  ],
  scale: [
    'M12 3.5v17M8 3.5h8',
    'M12 6 5 8l3.4 6.8a3.2 3.2 0 0 0 5.2 0L17 8l-7-2Z',
    'M4 20.5h16',
  ],
  // Ticket F-051 — bascule de thème (voir AppShell.tsx, useTheme). Croissant
  // formé par un seul tracé (différence de deux arcs), vérifié rendu en
  // navigateur réel (Chromium, script jetable) avant intégration — même
  // discipline que le reste de ce fichier (grille 24x24, trait seul,
  // extrémités arrondies).
  moon: ['M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5 7 7 0 0 0 20.5 14.5Z'],
};
