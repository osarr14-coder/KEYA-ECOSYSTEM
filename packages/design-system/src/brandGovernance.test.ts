import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Ticket F-039 — critère d'acceptation : « un test de garde vérifie
 * qu'aucun composant partagé (AlertBanner, StatusBadge, ProgressBar,
 * Button, Input, Select) ne référence brandColors ». Scanne le CODE
 * SOURCE réel (pas une simple relecture manuelle) de chaque composant
 * partagé du design system, à la recherche de la chaîne littérale
 * "brandColors" — même famille que `governance.test.ts` (ticket 007) et
 * la garde anti-attribution KEYIMMO (CLAUDE.md, ticket 006) : empêche
 * cette classe de régression de se glisser silencieusement dans un futur
 * commit, plutôt que de compter sur une revue manuelle.
 *
 * **Mise à jour F-048** — `AppShell` reste le SEUL composant partagé
 * exempté (contrôle positif ci-dessous), mais sa consommation de
 * `brandColors` n'est PLUS strictement HOME-only depuis ce ticket : le
 * bandeau `<header>` (F-039, prop `brand`) reste HOME-only, intouché ;
 * le bloc navy de sidebar (F-048, TOUJOURS rendu) est, lui, universel
 * sur les 4 apps — révision LIMITÉE et PRÉCISE de la doctrine 17.3,
 * jamais un abandon (voir CLAUDE.md, section F-048, et
 * `F-047-enrichissement-visuel-toute-plateforme.md`, rejeté, pour ce
 * qui reste explicitement hors mandat). La liste surveillée
 * (`FORBIDDEN_COMPONENT_DIRS`) ci-dessous n'a PAS changé par ce
 * ticket — `AppShell.test.tsx` porte les assertions de comportement
 * rendu qui bornent précisément cette exception (bloc sidebar/item
 * actif autorisés, `<main>`/items inactifs jamais colorés par la
 * marque).
 *
 * `levelMeta.ts` (TrustLevel, ticket 003/007) est INCLUS dans ce scan —
 * ce test protège aussi, comme effet de bord, l'invariant « aucun
 * ticket ne doit modifier levelMeta.ts ni s'en inspirer pour de
 * nouvelles valeurs » — règle non négociable, survit à F-048 comme à
 * toute révision future de la doctrine de marque.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentsDir = path.join(__dirname, 'components');

const FORBIDDEN_COMPONENT_DIRS = [
  'AlertBanner', 'StatusBadge', 'ProgressBar', 'Button', 'Input', 'Select',
  // Ticket F-046 — Card/Icon/TabBar créés après ce test (F-045), jamais
  // ajoutés à la liste surveillée : trou de couverture repéré à l'audit,
  // fermé ici. ProgressBar reste couvert malgré sa nouvelle prop
  // `fillColor` (F-046) — générique, aucun littéral "brandColors" dans son
  // code source, la couleur est fournie par l'appelant (voir ProgressBar.tsx).
  'Card', 'Icon', 'TabBar',
];

function readSourceFiles(dir: string): { file: string; content: string }[] {
  if (!existsSync(dir)) return [];
  const results: { file: string; content: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readSourceFiles(fullPath));
      continue;
    }
    if (/\.test\.[tj]sx?$/.test(entry.name)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    results.push({ file: fullPath, content: readFileSync(fullPath, 'utf-8') });
  }
  return results;
}

describe('Gouvernance — brandColors réservé à HOME (ticket F-039)', () => {
  it.each(FORBIDDEN_COMPONENT_DIRS)('%s ne référence "brandColors" nulle part dans son code source', (componentName) => {
    const files = readSourceFiles(path.join(componentsDir, componentName));
    expect(files.length).toBeGreaterThan(0); // sanity : le dossier existe bien et contient du code

    const offending = files.filter(({ content }) => content.includes('brandColors'));
    expect(offending.map((f) => path.relative(componentsDir, f.file))).toEqual([]);
  });

  it('contrôle positif — AppShell référence bien "brandColors" (preuve que le scan fonctionne réellement)', () => {
    const files = readSourceFiles(path.join(componentsDir, 'AppShell'));
    const offending = files.filter(({ content }) => content.includes('brandColors'));
    expect(offending.length).toBeGreaterThan(0);
  });
});
