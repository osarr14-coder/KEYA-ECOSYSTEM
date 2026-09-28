import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * PO-2026-09-28-22 — test de garde : aucune vue du back-office n'affiche
 * l'e-mail d'une personne (« organisation · rôle »). Seule exception :
 * Administration › Utilisateurs (`BackofficeView.tsx`), où l'e-mail est
 * l'identifiant de connexion. La garde serveur correspondante est
 * `apps/sales/test_audit_ui_r1_step6.py`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED = new Set(['BackofficeView.tsx']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('Garde : aucun e-mail dans les vues du back-office (PO-2026-09-28-22)', () => {
  it('seule la page Utilisateurs lit un e-mail', () => {
    const offenders = walk(path.join(here, 'views'))
      .filter((file) => !ALLOWED.has(path.basename(file)))
      .flatMap((file) => readFileSync(file, 'utf8').split('\n').flatMap((line, index) => (
        /\.email\b|_email\b/.test(line) ? [`${path.basename(file)}:${index + 1}: ${line.trim()}`] : []
      )));
    expect(offenders).toEqual([]);
  });
});
