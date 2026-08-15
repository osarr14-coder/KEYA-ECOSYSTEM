import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Ticket 007 — critère d'acceptation : « Aucun écran développé après ce
 * ticket ne redéfinit sa propre variante de badge de statut — un seul
 * composant, une seule source de vérité visuelle. » Ce test de garde ne peut
 * couvrir que ce à quoi CE ticket a accès : le contenu de
 * `packages/design-system/src/components`. Les futures apps (HOME/BUILD,
 * tickets 008+) vivront probablement dans des packages séparés que ce ticket
 * ne peut pas scanner — la garantie complète repose donc AUSSI sur la
 * documentation (CLAUDE.md, section Design System) qui pointe vers
 * `StatusBadge` comme unique source de vérité. Ce test garantit au moins que
 * ce package lui-même ne régresse jamais en interne.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentsDir = path.join(__dirname, 'components');

describe('Gouvernance — une seule source de vérité pour le badge de statut', () => {
  it('src/components ne contient qu\'un seul composant dont le nom évoque un badge de statut', () => {
    const componentDirectories = readdirSync(componentsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const badgeLikeComponents = componentDirectories.filter((name) => /badge/i.test(name));

    expect(badgeLikeComponents).toEqual(['StatusBadge']);
  });
});
