import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §12, « Tests de gouvernance ») : garde-fous
 * sur le code source des quatre apps et du design system. Ils lisent les
 * fichiers (hors tests) et échouent dès qu'une règle opposable du design
 * system est enfreinte : aucun dégradé, aucun flou, aucun rayon au-delà de
 * 6 px, plus d'ombre de carte, doré limité à la marque et à l'action
 * principale, texte doré limité à l'entrée de navigation active.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const SOURCE_DIRS = ['apps/web/src', 'apps/home/src', 'apps/build/src', 'apps/control-pwa/src', 'packages/design-system/src'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [full] : [];
  });
}

const FILES = SOURCE_DIRS.flatMap((dir) => walk(path.join(repoRoot, dir))).map((full) => ({
  file: path.relative(repoRoot, full),
  // Les commentaires racontent l'historique (« ancien dégradé… ») : seul le
  // code est contrôlé.
  code: readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, '')).replace(/^\s*\/\/.*$/gm, ''),
}));

function offenders(pattern: RegExp, allowed: Set<string> = new Set()) {
  return FILES
    .filter(({ file }) => !allowed.has(file))
    .flatMap(({ file, code }) => code.split('\n').flatMap((line, index) => (
      pattern.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : []
    )));
}

describe('Gouvernance du design system (PO-2026-09-27-20)', () => {
  it('lit bien les sources des quatre apps et du design system', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some(({ file }) => file.startsWith('apps/control-pwa/'))).toBe(true);
  });

  it('aucun dégradé (les hachures du marquage démo, à arrêts francs, restent permises)', () => {
    expect(offenders(/(?<!repeating-)linear-gradient\(|radial-gradient\(|conic-gradient\(/)).toEqual([]);
  });

  it('aucun flou ni effet de verre', () => {
    expect(offenders(/backdrop-?filter|backdropFilter|\bblur\(/)).toEqual([]);
  });

  it('aucun rayon au-delà de 6 px (cercles à 50 % permis)', () => {
    const radius = /border-?radius:\s*['"]?(\d+)px|borderRadius:\s*(\d+)\b/i;
    const found = FILES.flatMap(({ file, code }) => code.split('\n').flatMap((line, index) => {
      const match = radius.exec(line);
      const value = match ? Number(match[1] ?? match[2]) : 0;
      return value > 6 ? [`${file}:${index + 1}: ${line.trim()}`] : [];
    }));
    expect(found).toEqual([]);
  });

  it('plus d\'ombre de carte : seule --keya-shadow-overlay existe, pour menus et modales', () => {
    expect(offenders(/var\(--keya-shadow-(sm|md|lg)\)/)).toEqual([]);
  });

  it('le doré plein est réservé au logo et à l\'action principale', () => {
    const allowed = new Set([
      'packages/design-system/src/components/GlobalStyles/GlobalStyles.tsx',
      'packages/design-system/src/tokens/colors.ts',
      'packages/design-system/src/components/Button/Button.tsx',
      'packages/design-system/src/components/AppShell/AppShell.tsx',
      'apps/web/src/App.tsx',
      'apps/web/src/public/PublicLayout.tsx',
      'apps/web/src/public/PublicHome.tsx',
      'apps/home/src/components/ProgramHeroCard.tsx',
      'apps/control-pwa/src/App.tsx',
    ]);
    expect(offenders(/brandColors\.gold|accent\.solid|#C49A2C|rgba\(196,\s*154,\s*44/i, allowed)).toEqual([]);
  });

  it('le texte doré est réservé à l\'entrée de navigation active', () => {
    const allowed = new Set([
      'packages/design-system/src/components/GlobalStyles/GlobalStyles.tsx',
      'packages/design-system/src/tokens/colors.ts',
      'packages/design-system/src/components/AppShell/AppShell.tsx',
    ]);
    expect(offenders(/accent\.text|#E2C47A|#E4C878|#8A6A12/i, allowed)).toEqual([]);
  });
});
