import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Audit UI R1 (M01/M02, CDC §3.1, T13) — test de garde : les QUATRE apps
 * montent le bandeau de démonstration à leur racine de rendu (`main.tsx`),
 * donc sur tous les écrans (connexion, chargement, erreur, page publique).
 * Même famille que `brandGovernance.test.ts` : scan du code source réel.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appsDir = path.join(__dirname, '..', '..', '..', 'apps');

describe('Marquage démo monté dans chaque app (M01/M02)', () => {
  it.each(['web', 'home', 'build', 'control-pwa'])('%s monte <DemoBanner> à la racine', (app) => {
    const main = readFileSync(path.join(appsDir, app, 'src', 'main.tsx'), 'utf-8');
    expect(main).toMatch(/<DemoBanner apiBaseUrl=\{API_BASE_URL\} \/>/);
    // Avant <App />, jamais conditionné.
    expect(main.indexOf('<DemoBanner')).toBeLessThan(main.indexOf('<App'));
  });
});
