import { useEffect, useState } from 'react';

import { DEMO_MARKING } from '../../copy/demoCopy';
import { semanticColors } from '../../tokens/colors';

/**
 * Audit UI R1 (M01, M02) — bandeau de démonstration PERMANENT, monté une
 * fois à la racine de chaque app (web, HOME, BUILD, CONTROL), y compris sur
 * les écrans de connexion et la page publique (CDC R1 §3.1, T13).
 *
 * Toujours visible : collé en haut de la fenêtre (`position: sticky`), les
 * en-têtes collants des apps se placent dessous (`--keya-demo-banner-height`,
 * `GlobalStyles.tsx`). Grammaire hachurée à l'encre du thème — ni doré ni
 * couleur de statut, pour ne se confondre ni avec la marque ni avec un état.
 *
 * L'identifiant d'instance vient de `GET /api/public/demo-instance/` (sans
 * compte). Sans réponse, le marquage reste affiché, sans identifiant.
 */

export interface DemoInstanceInfo {
  code: string;
  dataset_version: string;
  environment: string;
}

let pending: Promise<DemoInstanceInfo | null> | null = null;

/** Une seule requête par chargement d'app, partagée entre montages. */
export function fetchDemoInstance(apiBaseUrl: string): Promise<DemoInstanceInfo | null> {
  if (pending === null) {
    pending = (typeof fetch === 'function'
      ? fetch(`${apiBaseUrl}/api/public/demo-instance/`)
        .then((response) => (response.ok ? response.json() : { instance: null }))
        .then((body: { instance?: DemoInstanceInfo | null }) => body?.instance ?? null)
      : Promise.resolve(null)
    ).catch(() => null);
  }
  return pending;
}

/** Pour les tests : oublie la requête partagée. */
export function resetDemoInstanceCache() {
  pending = null;
}

export interface DemoBannerProps {
  apiBaseUrl: string;
}

export function DemoBanner({ apiBaseUrl }: DemoBannerProps) {
  const [instance, setInstance] = useState<DemoInstanceInfo | null>(null);

  useEffect(() => {
    let active = true;
    void fetchDemoInstance(apiBaseUrl).then((info) => { if (active) setInstance(info); });
    return () => { active = false; };
  }, [apiBaseUrl]);

  return (
    <div
      role="note"
      aria-label={`${DEMO_MARKING}${instance ? `, instance ${instance.code}` : ''}`}
      data-testid="demo-banner"
      className="keya-demo-banner"
      style={{
        position: 'sticky', top: 0, zIndex: 1000, boxSizing: 'border-box', minHeight: 'var(--keya-demo-banner-height)',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: '10px',
        padding: '2px 12px', textAlign: 'center', lineHeight: 1.25,
        color: semanticColors.neutral.surface,
        background: `repeating-linear-gradient(-45deg, transparent 0 8px, rgba(128, 128, 128, 0.22) 8px 16px), ${semanticColors.neutral.heading}`,
        fontSize: '12px', fontWeight: 800, letterSpacing: '0.06em',
      }}
    >
      <span aria-hidden="true">{DEMO_MARKING}</span>
      {instance && (
        <span aria-hidden="true" data-testid="demo-banner-instance" style={{ fontWeight: 600, letterSpacing: '0.02em' }}>
          {`Instance ${instance.code}`}
        </span>
      )}
    </div>
  );
}
