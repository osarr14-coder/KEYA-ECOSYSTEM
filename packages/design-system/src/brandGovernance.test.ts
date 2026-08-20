import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Ticket F-039 — critère d'acceptation : « un test de garde vérifie
 * qu'aucun composant partagé (AlertBanner, StatusBadge, ProgressBar,
 * Button, Input, Select) ne référence brandColors — seule la variante
 * HOME d'AppShell (et le CTA de PriorityTaskSummary, `apps/home`) y a
 * accès. » Scanne le CODE SOURCE réel (pas une simple relecture manuelle)
 * de chaque composant partagé du design system, à la recherche de la
 * chaîne littérale "brandColors" — même famille que `governance.test.ts`
 * (ticket 007) et la garde anti-attribution KEYIMMO (CLAUDE.md, ticket
 * 006) : empêche cette classe de régression de se glisser silencieusement
 * dans un futur commit, plutôt que de compter sur une revue manuelle.
 *
 * `levelMeta.ts` (TrustLevel, ticket 003/007) est INCLUS dans ce scan —
 * ce test protège aussi, comme effet de bord, l'invariant « ce ticket ne
 * doit ni modifier levelMeta.ts ni s'en inspirer pour les nouvelles
 * valeurs » posé par F-039 lui-même.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentsDir = path.join(__dirname, 'components');

const FORBIDDEN_COMPONENT_DIRS = ['AlertBanner', 'StatusBadge', 'ProgressBar', 'Button', 'Input', 'Select'];

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
