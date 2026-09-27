import { useId } from 'react';

import {
  CONTROLLER_DESIGNATION, Icon, type IconName, semanticColors, typography,
} from '@keya/design-system';

/**
 * Triangle de Confiance — référence visuelle : diapositive « Le Triangle de
 * Confiance » fournie par le PO (trois pôles, liens en pointillés, libellé
 * central). Refait en HTML/CSS ACCESSIBLE : un titre et une liste de trois
 * rôles, lus dans l'ordre ; les liens du triangle sont décoratifs
 * (`aria-hidden`). Sous 640 px, disposition verticale.
 *
 * Textes : la diapositive est RÉÉCRITE selon le CDC R1 et les arbitrages
 * (aucun « séquestre », « sécurisation totale », « indépendance totale »,
 * « garantie » — J01/J02 ; formule J03 du PO pour le contrôleur ; Finance
 * est un opérateur de simulation, pas une banque partenaire — CDC §4). Seuls
 * des mécanismes réellement appliqués par le serveur sont décrits (ex. :
 * `milestone_disbursement_blockers` refuse tout décaissement d'un jalon non
 * accepté techniquement).
 */

export { CONTROLLER_DESIGNATION };

export const TRUST_TRIANGLE_NOTE = 'Démonstration : programme fictif, flux simulés, aucun fonds réel.';

interface TrustPole {
  key: 'platform' | 'account' | 'controller';
  icon: IconName;
  title: string;
  role: string;
  points: string[];
  note?: string;
}

export const TRUST_POLES: TrustPole[] = [
  {
    key: 'platform',
    icon: 'users',
    title: 'KEYIMMO AFRIC',
    role: 'Plateforme · coordination',
    points: [
      'Suit chaque dossier, de la réservation à la livraison',
      'Émet les appels de fonds selon le calendrier du contrat',
      'Transmet au client les pièces de chaque jalon',
      'Interlocuteur unique du client',
    ],
  },
  {
    key: 'account',
    icon: 'wallet',
    title: 'Compte du programme (simulé)',
    role: 'Finance · simulation',
    points: [
      'Reçoit les versements des acquéreurs',
      'Refuse tout décaissement tant que le jalon n’est pas accepté techniquement',
      'Chaque mouvement est rapproché et tracé',
      'Opérateur de simulation, pas une banque partenaire',
    ],
  },
  {
    key: 'controller',
    icon: 'clipboard-check',
    title: 'Contrôleur',
    role: 'Contrôle technique',
    points: [
      'Vérifie chaque jalon déclaré par le constructeur',
      'Fondations, puis Élévation',
      'Peut demander des corrections avant d’accepter',
    ],
    note: CONTROLLER_DESIGNATION,
  },
];

const CSS = `
.keya-trust { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px 32px; }
.keya-trust__links { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
.keya-trust__center { grid-column: 2; grid-row: 2; align-self: center; z-index: 1; }
.keya-trust__list { display: contents; }
.keya-trust__list, .keya-trust__pole { list-style: none; margin: 0; padding: 0; }
.keya-trust__pole { position: relative; z-index: 1; }
.keya-trust__pole--platform { grid-column: 2; grid-row: 1; }
.keya-trust__pole--account { grid-column: 1; grid-row: 2; margin-top: 56px; }
.keya-trust__pole--controller { grid-column: 3; grid-row: 2; margin-top: 56px; }
@media (max-width: 640px) {
  .keya-trust { grid-template-columns: minmax(0, 1fr); gap: 40px; }
  .keya-trust__links { display: none; }
  .keya-trust::before {
    content: ''; position: absolute; left: 50%; top: 80px; bottom: 24px; z-index: 0;
    border-left: 2px dashed var(--keya-neutral-border);
  }
  .keya-trust__center { grid-column: 1; grid-row: auto; }
  .keya-trust__pole--platform, .keya-trust__pole--account, .keya-trust__pole--controller {
    grid-column: 1; grid-row: auto; margin-top: 0;
  }
}
`;

function Pole({ pole, headingId }: { pole: TrustPole; headingId: string }) {
  return (
    <li role="listitem" className={`keya-trust__pole keya-trust__pole--${pole.key}`} data-testid={`trust-pole-${pole.key}`}>
      <article
        aria-labelledby={headingId}
        style={{
          height: '100%', boxSizing: 'border-box', padding: '40px 24px 24px', borderRadius: '20px', textAlign: 'left',
          background: semanticColors.neutral.surface, border: `1px solid ${semanticColors.neutral.border}`,
          boxShadow: 'var(--keya-shadow-md)', display: 'flex', flexDirection: 'column', gap: '12px',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', top: '-26px', left: '50%', transform: 'translateX(-50%)', width: '52px', height: '52px',
            borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: semanticColors.primary.background, color: semanticColors.primary.text,
            border: `4px solid ${semanticColors.neutral.background}`,
          }}
        >
          <Icon name={pole.icon} size={24} />
        </span>
        <h3 id={headingId} style={{ margin: 0, textAlign: 'center', fontSize: '21px' }}>{pole.title}</h3>
        <span
          style={{
            alignSelf: 'center', padding: '3px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase', background: semanticColors.neutral.subtle,
            color: semanticColors.neutral.textMuted,
          }}
        >
          {pole.role}
        </span>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '15px' }}>
          {pole.points.map((point) => (
            <li key={point} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px', color: semanticColors.neutral.heading }}>
                <Icon name="check-circle" size={16} />
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
        {pole.note && (
          <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted, fontStyle: 'italic' }}>{pole.note}</p>
        )}
      </article>
    </li>
  );
}

export function TrustTriangle() {
  const uid = useId().replace(/:/g, '');
  const labelId = `trust-label-${uid}`;
  return (
    <div data-testid="trust-triangle" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <style>{CSS}</style>
      <div className="keya-trust" style={{ paddingTop: '26px' }}>
        <svg className="keya-trust__links" aria-hidden="true" focusable="false">
          <g style={{ stroke: semanticColors.neutral.textMuted }} strokeWidth={2} strokeDasharray="7 7" fill="none">
            <line x1="50%" y1="30%" x2="17%" y2="62%" />
            <line x1="50%" y1="30%" x2="83%" y2="62%" />
            <line x1="17%" y1="62%" x2="83%" y2="62%" />
          </g>
        </svg>
        <p
          id={labelId}
          className="keya-trust__center"
          style={{
            margin: 0, textAlign: 'center', fontFamily: typography.headingFontFamily, fontSize: '20px', fontWeight: 600,
            color: semanticColors.neutral.heading, background: semanticColors.neutral.background, padding: '4px 8px',
          }}
        >
          Trois rôles distincts
        </p>
        {/* `display: contents` peut effacer la sémantique de liste : rôles explicites. */}
        <ul role="list" className="keya-trust__list" aria-labelledby={labelId}>
          {TRUST_POLES.map((pole) => <Pole key={pole.key} pole={pole} headingId={`trust-${pole.key}-${uid}`} />)}
        </ul>
      </div>
      <p data-testid="trust-triangle-note" style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
        {TRUST_TRIANGLE_NOTE}
      </p>
    </div>
  );
}
