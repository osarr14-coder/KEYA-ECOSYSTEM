import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Ticket 007 — critère d'acceptation : « Aucun écran développé après ce
 * ticket ne redéfinit sa propre variante de badge de statut — un seul
 * composant, une seule source de vérité visuelle. »
 *
 * Scanne le CODE SOURCE (pas juste les noms de dossier, contrairement à la
 * première version de ce test) à la recherche d'un composant exporté dont le
 * nom évoque un badge, dans deux périmètres :
 *   1. `packages/design-system/src` lui-même (`StatusBadge` doit être le seul).
 *   2. `<racine du monorepo>/apps`, une fois ce dossier créé par un ticket
 *      futur (008 HOME, 009 BUILD...). Tant qu'il n'existe pas, il n'y a
 *      rien à scanner — mais le jour où il apparaît, CE MÊME test (sans
 *      modification) commence à le couvrir automatiquement. Ne pas le
 *      supprimer ni le neutraliser en pensant qu'il "ne sert à rien" avant
 *      ce moment-là — voir CLAUDE.md, section Design system frontend.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const designSystemSrcDir = __dirname;
const appsDir = path.join(repoRoot, 'apps');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', 'coverage']);

// Composants dont le nom contient "Badge" mais qui ne sont PAS des variantes
// concurrentes de StatusBadge (ex : un badge numérique générique pour un
// compteur, concept différent d'un badge de niveau de confiance) — à
// documenter ici avec la raison plutôt que d'affaiblir la regex ou de
// supprimer le test.
const ALLOWLISTED_BADGE_COMPONENT_NAMES = new Set<string>([]);

// `export function XBadge`, `export const XBadge = ...` — matche une vraie
// DÉFINITION de composant. Un `export { StatusBadge } from '...'` (simple
// re-export, ex: apps/web importe et ré-exporte le composant du design
// system) ne matche volontairement pas : ce n'est pas une redéfinition.
const BADGE_DEFINITION_PATTERN = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+(\w*Badge\w*)\b/g;

interface BadgeMatch {
  file: string;
  name: string;
}

function findBadgeComponentDefinitions(dir: string): BadgeMatch[] {
  if (!existsSync(dir)) return [];

  const matches: BadgeMatch[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORED_DIR_NAMES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      matches.push(...findBadgeComponentDefinitions(fullPath));
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (/\.test\.[tj]sx?$/.test(entry.name)) continue;

    const content = readFileSync(fullPath, 'utf-8');
    for (const match of content.matchAll(BADGE_DEFINITION_PATTERN)) {
      const name = match[1];
      if (ALLOWLISTED_BADGE_COMPONENT_NAMES.has(name)) continue;
      matches.push({ file: path.relative(repoRoot, fullPath), name });
    }
  }
  return matches;
}

describe('Gouvernance — une seule source de vérité pour le badge de statut', () => {
  it('packages/design-system ne définit qu\'un seul composant de badge (StatusBadge)', () => {
    const found = findBadgeComponentDefinitions(designSystemSrcDir);
    expect(found.map((m) => m.name)).toEqual(['StatusBadge']);
  });

  it('/apps (une fois créé par un ticket futur) ne redéfinit aucun composant de badge', () => {
    if (!existsSync(appsDir)) {
      // Rien à scanner tant que /apps n'existe pas — voir le commentaire de
      // tête. Assertion volontairement présente (pas un `return` silencieux)
      // pour que ce cas reste visible dans le rapport de test plutôt que de
      // ressembler à un test vide.
      expect(existsSync(appsDir)).toBe(false);
      return;
    }

    const offending = findBadgeComponentDefinitions(appsDir);
    expect(offending).toEqual([]);
  });
});
