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
  /** PO-2026-09-28-18 : ORGANISATION de l'acteur, jamais un e-mail. */
  by: string;
  /** PO-2026-09-28-04 : rôle de l'acteur (« Constructeur », « Contrôleur »). */
  role?: string;
  at: string;
  version: string;
  scope: string;
}

/** Vocabulaire des niveaux côté serveur (`apps/trust/models.py::TrustLevel`). */
export type TrustLevel = 'declare' | 'documente' | 'controle' | 'verifie' | 'valide';

export const TRUST_LEVEL_FROM_API: Record<TrustLevel, TrustLevelKey> = {
  declare: 'declared', documente: 'documented', controle: 'controlled', verifie: 'verified', valide: 'validated',
};

/** Événement de confiance isolé (dernier événement, provenance d'une
 * pièce) : une LIGNE de texte datée et attribuée, jamais un badge. */
export interface TrustEventData {
  level: TrustLevel;
  /** Provenance technique de l'événement (non affichée par la ligne). */
  source?: string;
  actor: string;
  createdAt: string;
  scope?: string;
}

export function TrustEventLine({ event, 'data-testid': testId = 'trust-event' }: { event: TrustEventData; 'data-testid'?: string }) {
  const key = TRUST_LEVEL_FROM_API[event.level];
  return (
    <span data-testid={testId} data-level={event.level} style={{ fontSize: '14px', color: semanticColors.neutral.text }}>
      <strong style={{ color: semanticColors.neutral.heading }}>{`Niveau atteint : ${TRUST_LEVEL_LABELS[key]}`}</strong>
      {` · ${event.actor} · `}
      <DateTime value={event.createdAt} />
      {event.scope ? ` · périmètre : ${event.scope}` : ''}
    </span>
  );
}

/** PO-2026-09-28-18 : une personne s'affiche « organisation · rôle »,
 * jamais d'e-mail ni de double parenthèse. */
function personLabel({ by, role }: { by: string; role?: string }) {
  return [by, role].filter(Boolean).join(' · ');
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
                  {`${personLabel(evidence)} · `}
                  <DateTime value={evidence.at} />
                  {' · version examinée : '}
                  <Reference value={evidence.version} label="Version examinée" copyable={false} />
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
