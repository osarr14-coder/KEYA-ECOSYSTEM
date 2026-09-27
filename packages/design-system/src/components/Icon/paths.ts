/**
 * Audit UI R1, étape 3 — PO-2026-09-27-20 (A-DS-2) : tracés des icônes
 * **Lucide** (https://lucide.dev), repris en ligne sans dépendance npm, grille
 * 24x24, trait seul. Formes `rect`, `circle`, `line` et `poly*` converties en
 * chemins `d` équivalents.
 *
 * Lucide — licence ISC : Copyright (c) for portions of Lucide are held by
 * Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for
 * Lucide are held by Lucide Contributors 2022. Permission to use, copy,
 * modify, and/or distribute this software for any purpose with or without fee
 * is hereby granted, provided that the above copyright notice and this
 * permission notice appear in all copies.
 *
 * DESIGN_SYSTEM §5.4 : une icône par concept (portefeuille = encaissements
 * du client, balance = paliers, bouclier = contrôle, repère bancaire = comptes
 * du programme, reçu = appels et encaissements, dossier = dossiers clients,
 * étiquette = lots et prix, historique = journal, liste cochée = À faire).
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
  | 'check'
  | 'check-circle'
  | 'users'
  | 'camera'
  | 'scale'
  | 'moon'
  | 'log-out'
  | 'folder'
  | 'tag'
  | 'landmark'
  | 'receipt'
  | 'arrow-down-to-line'
  | 'history'
  | 'list-checks'
  | 'key-round'
  | 'copy'
  | 'lock';

export const ICON_PATHS: Record<IconName, string[]> = {
  'home': [
    'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8',
    'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
  'building': [
    'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z',
    'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2',
    'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2',
    'M10 6h4',
    'M10 10h4',
    'M10 14h4',
    'M10 18h4',
  ],
  'clipboard-check': [
    'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1Z',
    'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
    'm9 14 2 2 4-4',
  ],
  'file-text': [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M10 9H8',
    'M16 13H8',
    'M16 17H8',
  ],
  'wallet': [
    'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1',
    'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  ],
  'shield-check': [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    'm9 12 2 2 4-4',
  ],
  'bell': [
    'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9',
    'M10.3 21a1.94 1.94 0 0 0 3.4 0',
  ],
  'search': [
    'M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
    'm21 21-4.3-4.3',
  ],
  'chevron-left': [
    'm15 18-6-6 6-6',
  ],
  'chevron-right': [
    'm9 18 6-6-6-6',
  ],
  'alert-triangle': [
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    'M12 9v4',
    'M12 17h.01',
  ],
  check: ['M20 6 9 17l-5-5'],
  'check-circle': [
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    'm9 12 2 2 4-4',
  ],
  'users': [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  'camera': [
    'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z',
    'M9 13a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  ],
  'scale': [
    'm16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z',
    'm2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z',
    'M7 21h10',
    'M12 3v18',
    'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2',
  ],
  'moon': [
    'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  ],
  'log-out': [
    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
    'M16 17L21 12L16 7',
    'M21 12L9 12',
  ],
  'folder': [
    'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  ],
  'tag': [
    'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
    'M7.0 7.5a0.5 0.5 0 1 0 1.0 0a0.5 0.5 0 1 0 -1.0 0',
  ],
  'landmark': [
    'M3 22L21 22',
    'M6 18L6 11',
    'M10 18L10 11',
    'M14 18L14 11',
    'M18 18L18 11',
    'M12 2L20 7L4 7Z',
  ],
  'receipt': [
    'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z',
    'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8',
    'M12 17.5v-11',
  ],
  'arrow-down-to-line': [
    'M12 17V3',
    'm6 11 6 6 6-6',
    'M19 21H5',
  ],
  'history': [
    'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8',
    'M3 3v5h5',
    'M12 7v5l4 2',
  ],
  'list-checks': [
    'm3 17 2 2 4-4',
    'm3 7 2 2 4-4',
    'M13 6h8',
    'M13 12h8',
    'M13 18h8',
  ],
  'key-round': [
    'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z',
    'M16.0 7.5a0.5 0.5 0 1 0 1.0 0a0.5 0.5 0 1 0 -1.0 0',
  ],
  'copy': [
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2Z',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ],
  'lock': [
    'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2Z',
    'M7 11V7a5 5 0 0 1 10 0v4',
  ],
};
