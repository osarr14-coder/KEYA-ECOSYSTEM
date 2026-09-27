import { semanticColors } from '../../tokens/colors';
import { DateTime } from '../DateTime/DateTime';
import { Icon } from '../Icon/Icon';
import { Reference } from '../Reference/Reference';

/**
 * PO-2026-09-27-20 (DESIGN_SYSTEM §8.1, CDC §7) : niveaux de confiance en
 * ÉCHELLE D'ÉTAPES — jamais un badge, une jauge, un score ni un
 * pourcentage. Chaque niveau atteint dit qui, quand, sur quelle version et
 * dans quel périmètre ; un niveau non atteint reste visible et vide. Le
 * niveau « Validé » précise toujours le contrôleur (« Validé techniquement —
 * démonstration »).
 */
export type TrustLevelKey = 'declared' | 'documented' | 'controlled' | 'verified' | 'validated';

export const TRUST_LEVEL_LABELS: Record<TrustLevelKey, string> = {
  declared: 'Déclaré',
  documented: 'Documenté',
  controlled: 'Contrôlé',
  verified: 'Vérifié',
  validated: 'Validé techniquement — démonstration',
};

export const TRUST_LEVEL_ORDER: TrustLevelKey[] = ['declared', 'documented', 'controlled', 'verified', 'validated'];

export interface TrustLevelEvidence {
  by: string;
  at: string;
  version: string;
  scope: string;
}

export interface TrustLevelsProps {
  /** Niveaux atteints, avec leur preuve ; les autres s'affichent vides. */
  reached: Partial<Record<TrustLevelKey, TrustLevelEvidence>>;
  'aria-label'?: string;
}

export function TrustLevels({ reached, 'aria-label': ariaLabel = 'Niveaux de confiance' }: TrustLevelsProps) {
  return (
    <ol aria-label={ariaLabel} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {TRUST_LEVEL_ORDER.map((key, index) => {
        const evidence = reached[key];
        return (
          <li
            key={key}
            data-testid={`trust-level-${key}`}
            data-reached={evidence ? 'true' : 'false'}
            style={{
              display: 'grid', gridTemplateColumns: '24px 1fr', gap: '12px', padding: '10px 0',
              borderTop: index === 0 ? 'none' : `1px solid ${semanticColors.neutral.border}`,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '20px', height: '20px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: `1.5px solid ${evidence ? semanticColors.neutral.heading : semanticColors.neutral.border}`,
                background: evidence ? semanticColors.neutral.heading : 'transparent',
                color: semanticColors.neutral.surface,
              }}
            >
              {evidence && <Icon name="check" size={14} />}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <span style={{ fontWeight: evidence ? 700 : 500, color: evidence ? semanticColors.neutral.heading : semanticColors.neutral.textMuted }}>
                {TRUST_LEVEL_LABELS[key]}
              </span>
              {evidence ? (
                <span style={{ fontSize: '13px', color: semanticColors.neutral.text }}>
                  {`${key === 'validated' ? 'Contrôleur : ' : ''}${evidence.by} · `}
                  <DateTime value={evidence.at} />
                  {' · version '}
                  <Reference value={evidence.version} label="Version" copyable={false} />
                  {` · périmètre : ${evidence.scope}`}
                </span>
              ) : (
                <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>Non atteint</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
