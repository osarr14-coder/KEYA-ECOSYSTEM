import { useState } from 'react';

import {
  Button, Icon, type IconName, Pill, Select, brandColors, semanticColors, typography, useIsMobile,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { PublicProgram, PublicWorksite } from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { FacadeIllustration } from './illustrations/FacadeIllustration';
import { LotPlanA1 } from './illustrations/LotPlanA1';
import { CONTROLLER_DESIGNATION, TrustTriangle } from './illustrations/TrustTriangle';
import { paymentBreakdown } from './paymentBreakdown';
import { CONTAINER_STYLE } from './PublicLayout';
import type { PublicPath } from './usePublicPath';

/**
 * Ticket F-079 — page d'accueil publique de KEYA, inspirée de la vitrine
 * `keya-frontend` (dépôt KEYA, `pages/public/Landing.jsx`) et adaptée au
 * modèle d'ECOSYSTEM (programmes et lots, paiements par paliers). Toutes
 * les données viennent de la vitrine anonyme B-057 : aucun chiffre inventé,
 * aucun faux témoignage (retirés tant qu'il n'existe pas de vrais retours
 * clients).
 */

function formatXof(value: number | string) {
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} XOF`;
}

function Section({
  id, eyebrow, title, subtitle, tinted = false, children,
}: {
  id: string; eyebrow: string; title: string; subtitle?: string; tinted?: boolean; children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      style={{
        padding: 'clamp(48px, 7vw, 88px) 0', background: tinted ? semanticColors.neutral.surface : 'transparent', scrollMarginTop: '80px',
      }}
    >
      <div style={CONTAINER_STYLE}>
        <div style={{ maxWidth: '720px', marginBottom: '32px' }}>
          <span
            style={{
              fontSize: '13px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: semanticColors.accent.text,
            }}
          >
            {eyebrow}
          </span>
          <h2 id={`${id}-title`} style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 3.4vw, 38px)' }}>{title}</h2>
          {subtitle && <p style={{ margin: '12px 0 0', fontSize: '17px', color: semanticColors.neutral.textMuted }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/**
 * Audit UI R1 (J01–J03) : le mécanisme DÉMONTRÉ, décrit sans promesse —
 * aucun « séquestre », « protégé », « sécurisé », « garantie » ; formule
 * neutre du PO pour le contrôleur (PO-2026-09-27-01).
 */
const MECHANISMS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'wallet',
    title: 'Versements sur le compte du programme (simulé)',
    text: 'Chaque versement est enregistré sur un compte propre au programme, distinct de celui de KEYIMMO AFRIC. Chaque appel de fonds porte sa propre référence.',
  },
  {
    icon: 'clipboard-check',
    title: 'Un contrôleur examine chaque jalon',
    text: `Il examine les pièces déposées par le constructeur avant toute acceptation technique. ${CONTROLLER_DESIGNATION}`,
  },
  {
    icon: 'check-circle',
    title: 'Décaissement après acceptation technique',
    text: 'La plateforme refuse tout décaissement au constructeur tant que le jalon n’est pas accepté techniquement ; une réserve ouverte le bloque aussi.',
  },
];

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Choisissez et réservez',
    text: 'Réservez un lot depuis votre espace : il est bloqué pour vous le temps d’enregistrer les frais de réservation.',
  },
  {
    title: 'Signez et versez',
    text: 'Réglez les frais de réservation par virement (simulé), signez votre contrat (signature simulée), puis le complément du premier versement.',
  },
  {
    title: 'Suivez votre chantier',
    text: 'Suivez chaque jalon depuis votre espace : déclaration du constructeur, examen du contrôleur, réserves et levées.',
  },
];

const FAQ: { q: string; r: string }[] = [
  {
    q: 'Comment fonctionnent les versements ?',
    r: 'Dans cette démonstration, vos versements sont enregistrés sur le compte du programme (simulé), distinct de celui de KEYIMMO AFRIC. Le constructeur n’est payé que jalon par jalon, après acceptation technique par le contrôleur. Tous les flux sont simulés : aucun fonds réel.',
  },
  {
    q: 'Comment se passe la réservation ?',
    r: 'Vous réservez un lot depuis votre espace acquéreur : il est bloqué pour vous. Vous recevez l’appel des frais de réservation et des instructions de virement fictives ; Finance enregistre l’encaissement simulé à réception.',
  },
  {
    q: 'Combien dois-je verser, et quand ?',
    r: 'Les frais de réservation, puis le complément du premier versement à la signature, puis les versements suivants de l’échéancier du programme. Le simulateur ci-dessus en donne une estimation indicative, sur des montants fictifs.',
  },
  {
    q: 'Puis-je suivre le chantier à distance ?',
    r: 'Oui : votre espace montre les étapes de votre acquisition, l’avancement du chantier jalon par jalon et chacun de vos appels de fonds.',
  },
  {
    q: 'Que se passe-t-il si un jalon n’est pas conforme ?',
    r: 'Le contrôleur ouvre une réserve. Tant que le contrôleur ne l’a pas levée après un nouvel examen, aucun décaissement de ce jalon n’est possible.',
  },
];

function Hero({ navigate }: { navigate: (path: PublicPath) => void }) {
  return (
    <section style={{ background: `linear-gradient(160deg, ${brandColors.navy} 0%, #071527 100%)`, color: '#FFFFFF' }}>
      <div
        style={{
          ...CONTAINER_STYLE,
          padding: 'clamp(56px, 8vw, 104px) clamp(16px, 4vw, 40px)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          gap: '40px',
          alignItems: 'center',
        }}
      >
        <div>
          <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E2C47A' }}>
            Démonstration · Abidjan · données fictives
          </span>
          <h1 style={{ margin: '16px 0 18px', color: '#FFFFFF', fontSize: 'clamp(36px, 5vw, 58px)', lineHeight: 1.08 }}>
            Suivre un achat immobilier neuf, du versement au chantier
          </h1>
          <p style={{ margin: '0 0 32px', fontSize: '18px', color: 'rgba(255, 255, 255, 0.82)', maxWidth: '540px' }}>
            Cette démonstration déroule le parcours d’un acquéreur sur un programme fictif : chaque versement est enregistré sur
            le compte du programme (simulé), chaque jalon est examiné par un contrôleur, et aucun décaissement n’est possible
            sans acceptation technique.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <a href="#programmes" className="keya-btn" style={heroButton(true)}>Voir les programmes</a>
            <a href="#simulateur" className="keya-btn" style={heroButton(false)}>Simuler mes paiements</a>
          </div>
          <p style={{ margin: '24px 0 0', fontSize: '15px', color: 'rgba(255, 255, 255, 0.7)' }}>
            Vous avez reçu un compte de démonstration ?{' '}
            <a
              href="/connexion"
              onClick={(event) => { event.preventDefault(); navigate('/connexion'); }}
              style={{ color: '#E2C47A', fontWeight: 700 }}
            >
              Se connecter
            </a>
          </p>
        </div>
        <ul
          aria-label="Le mécanisme démontré"
          style={{
            listStyle: 'none', margin: 0, padding: '28px', borderRadius: '24px', background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(226, 196, 122, 0.3)', display: 'flex', flexDirection: 'column', gap: '22px',
          }}
        >
          {MECHANISMS.map((item) => (
            <li key={item.title} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <span
                aria-hidden="true"
                style={{
                  width: '44px', height: '44px', flexShrink: 0, borderRadius: '12px', display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', background: 'rgba(196, 154, 44, 0.2)', color: '#E2C47A',
                }}
              >
                <Icon name={item.icon} size={22} />
              </span>
              <span>
                <strong style={{ display: 'block', fontSize: '16px' }}>{item.title}</strong>
                <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.72)' }}>{item.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function heroButton(primary: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '52px',
    padding: '0 24px',
    borderRadius: '14px',
    fontWeight: 700,
    fontSize: '16px',
    background: primary ? brandColors.gold : 'transparent',
    color: primary ? brandColors.navy : '#FFFFFF',
    border: primary ? 'none' : '1px solid rgba(255, 255, 255, 0.4)',
  } as const;
}

function ProgramCard({ program, navigate }: { program: PublicProgram; navigate: (path: PublicPath) => void }) {
  const soldOut = program.available_lots === 0;
  return (
    <article
      data-testid="public-program"
      aria-label={program.name}
      style={{
        display: 'flex', flexDirection: 'column', borderRadius: '24px', overflow: 'hidden', background: semanticColors.neutral.surface,
        border: `1px solid ${semanticColors.neutral.border}`, boxShadow: 'var(--keya-shadow-md)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `linear-gradient(135deg, ${brandColors.navy}, #1C3563)`, color: '#E2C47A',
        }}
      >
        <Icon name="building" size={56} />
      </div>
      <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '10px', flexGrow: 1 }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill tone={soldOut ? 'neutral' : 'success'}>
            {soldOut ? 'Complet' : `${program.available_lots} lot${program.available_lots > 1 ? 's' : ''} disponible${program.available_lots > 1 ? 's' : ''}`}
          </Pill>
          <span style={{ fontSize: '14px', color: semanticColors.neutral.textMuted }}>{`${program.total_lots} lot(s) au total`}</span>
        </div>
        <h3 style={{ margin: 0, fontSize: '24px' }}>{program.name}</h3>
        <span style={{ color: semanticColors.neutral.textMuted }}>
          {[program.locations.join(', '), 'Programme lancé par KEYIMMO AFRIC', `Constructeur : ${program.constructeur}`].filter(Boolean).join(' · ')}
        </span>
        <span style={{ fontSize: '15px' }}>
          {soldOut ? 'Prix constatés à partir de ' : 'À partir de '}
          <strong style={{ fontFamily: typography.headingFontFamily, fontSize: '22px', color: semanticColors.neutral.heading }}>
            {formatXof(program.price_from)}
          </strong>
        </span>
        {program.lots.length > 0 && (
          <table aria-label={`Lots disponibles — ${program.name}`}>
            <thead>
              <tr><th>Lot</th><th>Surface</th><th style={{ textAlign: 'right' }}>Prix</th></tr>
            </thead>
            <tbody>
              {program.lots.slice(0, 4).map((lot) => (
                <tr key={lot.id}>
                  <td>{`${lot.name} · ${lot.asset}`}</td>
                  <td>{lot.surface ? `${Number(lot.surface).toLocaleString('fr-FR')} m²` : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatXof(lot.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 'auto', paddingTop: '8px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {!soldOut && (
            <Button type="button" variant="accent" onClick={() => navigate('/acces')}>
              Réserver — accès sur invitation
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

const STATUS_COLOR: Record<string, string> = {
  accepted: semanticColors.progress.fill,
  awaiting_control: semanticColors.accent.solid,
  under_reserve: semanticColors.danger.border,
  awaiting_documents: semanticColors.alert.border,
  not_declared: semanticColors.neutral.border,
};

function WorksiteCard({ worksite }: { worksite: PublicWorksite }) {
  const current = worksite.milestones.find((milestone) => milestone.status !== 'accepted' && milestone.status !== 'not_declared')
    ?? worksite.milestones.find((milestone) => milestone.status === 'not_declared');
  return (
    <article
      data-testid="public-worksite"
      aria-label={`${worksite.program} — ${worksite.lot}`}
      style={{
        borderRadius: '20px', padding: '20px 22px', background: semanticColors.neutral.surface,
        border: `1px solid ${semanticColors.neutral.border}`, display: 'flex', flexDirection: 'column', gap: '12px',
      }}
    >
      <div>
        <strong style={{ fontSize: '17px' }}>{worksite.lot}</strong>
        <div style={{ fontSize: '14px', color: semanticColors.neutral.textMuted }}>
          {[worksite.program, worksite.location].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div aria-hidden="true" style={{ display: 'flex', gap: '4px' }}>
        {worksite.milestones.map((milestone) => (
          <span
            key={milestone.label}
            title={`${milestone.label} — ${milestone.status_label}`}
            style={{ flex: 1, height: '8px', borderRadius: '4px', background: STATUS_COLOR[milestone.status] ?? semanticColors.neutral.border }}
          />
        ))}
      </div>
      <span style={{ fontWeight: 700 }}>{`${worksite.accepted} / ${worksite.total} étapes acceptées`}</span>
      {current && (
        <span style={{ fontSize: '14px', color: semanticColors.neutral.textMuted }}>
          {`En cours : ${current.label} — ${current.status_label}`}
        </span>
      )}
    </article>
  );
}

function Simulator({ programs }: { programs: PublicProgram[] }) {
  const [programId, setProgramId] = useState(programs[0]?.id ?? '');
  const program = programs.find((candidate) => candidate.id === programId) ?? programs[0];
  const [lotId, setLotId] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const lot = program?.lots.find((candidate) => candidate.id === lotId);
  const price = lot ? Number(lot.price) : Number(customPrice.replace(/\s/g, '') || program?.price_from || 0);
  const rows = program ? paymentBreakdown(price, program.payment_schedule) : [];

  if (!program) {
    return <p>Le simulateur sera disponible dès la publication d’un premier programme.</p>;
  }

  const labelStyle = { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600 } as const;
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '24px', alignItems: 'start',
      }}
    >
      <div
        style={{
          borderRadius: '24px', padding: '24px', background: semanticColors.neutral.surface,
          border: `1px solid ${semanticColors.neutral.border}`, display: 'flex', flexDirection: 'column', gap: '16px',
        }}
      >
        <label style={labelStyle}>
          Programme
          <Select
            aria-label="Programme simulé"
            value={program.id}
            onChange={(event) => { setProgramId(event.target.value); setLotId(''); }}
          >
            {programs.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </Select>
        </label>
        {program.lots.length > 0 && (
          <label style={labelStyle}>
            Lot
            <Select aria-label="Lot simulé" value={lotId} onChange={(event) => setLotId(event.target.value)}>
              <option value="">Autre prix (saisie libre)</option>
              {program.lots.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{`${candidate.name} — ${formatXof(candidate.price)}`}</option>
              ))}
            </Select>
          </label>
        )}
        {!lot && (
          <label style={labelStyle}>
            Prix du bien (XOF)
            <input
              className="keya-input"
              aria-label="Prix du bien simulé"
              inputMode="numeric"
              value={customPrice}
              placeholder={Number(program.price_from).toLocaleString('fr-FR')}
              onChange={(event) => setCustomPrice(event.target.value)}
              style={{
                minHeight: '44px', padding: '0 14px', borderRadius: '12px', border: `1px solid ${semanticColors.neutral.border}`,
                fontSize: '15px', background: semanticColors.neutral.surface, color: semanticColors.neutral.text,
              }}
            />
          </label>
        )}
        <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
          Échéancier indicatif, calculé avec le barème de démonstration du programme (fictif, non validé juridiquement).
          Aucun appel de fonds n’est émis depuis ce simulateur.
        </p>
      </div>
      <div
        style={{
          borderRadius: '24px', padding: '24px', background: semanticColors.neutral.surface,
          border: `2px solid ${semanticColors.accent.solid}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <span style={{ color: semanticColors.neutral.textMuted }}>Prix simulé</span>
          <strong data-testid="simulated-price" style={{ fontFamily: typography.headingFontFamily, fontSize: '28px', color: semanticColors.neutral.heading }}>
            {formatXof(price)}
          </strong>
        </div>
        <table aria-label="Échéancier indicatif">
          <thead>
            <tr><th>Étape</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'right' }}>Cumul</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-testid="simulator-row">
                <td>
                  <div style={{ fontWeight: 700 }}>{row.label}</div>
                  <div style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>{row.when}</div>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatXof(row.amount)}</td>
                <td style={{ textAlign: 'right' }}>{`${row.cumulativePercent.toLocaleString('fr-FR')} %`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PublicHome({ navigate }: { navigate: (path: PublicPath) => void }) {
  const api = useApiClient();
  const isMobile = useIsMobile();
  const offerState = useApiResource(() => api.getPublicOffer(), []);
  const worksitesState = useApiResource(() => api.getPublicWorksites(), []);
  // Programmes avec des lots disponibles d'abord (aussi le choix par défaut
  // du simulateur), puis les programmes complets.
  const programs = offerState.status === 'success'
    ? [...offerState.data].sort((a, b) => Number(b.available_lots > 0) - Number(a.available_lots > 0))
    : [];
  const worksites = worksitesState.status === 'success' ? worksitesState.data : [];

  return (
    <>
      <Hero navigate={navigate} />

      <Section
        id="programmes"
        eyebrow="Programmes"
        title="Programmes de démonstration"
        subtitle="Programmes, biens et prix fictifs. Un bien réservé n’apparaît plus comme disponible."
      >
        <div
          style={{
            display: 'grid', gap: '24px', marginBottom: '32px', alignItems: 'stretch',
            gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 2fr) minmax(0, 1fr)',
          }}
        >
          <FacadeIllustration />
          <LotPlanA1 />
        </div>
        {offerState.status === 'loading' && <p>Chargement des programmes…</p>}
        {offerState.status === 'error' && <p role="alert">Les programmes sont momentanément indisponibles. Réessayez dans un instant.</p>}
        {offerState.status === 'success' && programs.length === 0 && <p>Aucun programme publié pour le moment.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: '24px' }}>
          {programs.map((program) => <ProgramCard key={program.id} program={program} navigate={navigate} />)}
        </div>
      </Section>

      <Section id="etapes" eyebrow="Le parcours" title="Le parcours acquéreur en trois étapes" tinted>
        <ol
          style={{
            listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '24px',
          }}
        >
          {STEPS.map((step, index) => (
            <li key={step.title} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span
                aria-hidden="true"
                style={{
                  width: '48px', height: '48px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: semanticColors.primary.background, color: semanticColors.primary.text, fontFamily: typography.headingFontFamily,
                  fontSize: '20px', fontWeight: 600,
                }}
              >
                {index + 1}
              </span>
              <h3 style={{ margin: 0, fontSize: '21px' }}>{step.title}</h3>
              <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="fonctionnement"
        eyebrow="Comment ça marche"
        title="Trois rôles distincts"
        subtitle="Ce que la démonstration applique, sur des données fictives : qui encaisse, qui examine, qui décaisse."
      >
        <TrustTriangle />
      </Section>

      <Section
        id="chantiers"
        eyebrow={worksites.length > 0 ? `${worksites.length} chantier${worksites.length > 1 ? 's' : ''} en cours` : 'Chantiers'}
        title="Des chantiers suivis, jalon par jalon"
        subtitle="L’avancement des chantiers du programme fictif, sans aucune donnée client : chaque étape est déclarée, documentée puis contrôlée."
        tinted
      >
        {worksitesState.status === 'success' && worksites.length === 0 && <p>Aucun chantier démarré pour le moment.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '20px' }}>
          {worksites.map((worksite) => <WorksiteCard key={`${worksite.program}-${worksite.lot}`} worksite={worksite} />)}
        </div>
        {worksites.length > 0 && (
          <p style={{ margin: '20px 0 0', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '14px', color: semanticColors.neutral.textMuted }}>
            {[
              ['accepted', 'Acceptée'], ['awaiting_control', 'En contrôle'], ['under_reserve', 'Sous réserve'],
              ['awaiting_documents', 'Pièces attendues'], ['not_declared', 'À venir'],
            ].map(([status, label]) => (
              <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '50%', background: STATUS_COLOR[status] }} />
                {label}
              </span>
            ))}
          </p>
        )}
      </Section>

      <Section
        id="simulateur"
        eyebrow="Simulateur"
        title="Combien verser, et quand ?"
        subtitle="Choisissez un lot ou saisissez un prix : l’échéancier suit le barème de démonstration du programme."
      >
        {offerState.status === 'success' && <Simulator programs={programs} />}
      </Section>

      <Section id="faq" eyebrow="Questions fréquentes" title="Tout ce qu’il faut savoir" tinted>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '860px' }}>
          {FAQ.map((item) => (
            <details
              key={item.q}
              style={{
                borderRadius: '16px', padding: '18px 22px', border: `1px solid ${semanticColors.neutral.border}`,
                background: semanticColors.neutral.background,
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '17px' }}>{item.q}</summary>
              <p style={{ margin: '12px 0 0', color: semanticColors.neutral.textMuted }}>{item.r}</p>
            </details>
          ))}
        </div>
      </Section>

      <section style={{ background: `linear-gradient(160deg, ${brandColors.navy} 0%, #071527 100%)`, color: '#FFFFFF' }}>
        <div
          style={{
            ...CONTAINER_STYLE, padding: 'clamp(40px, 6vw, 72px) clamp(16px, 4vw, 40px)', display: 'flex', flexWrap: 'wrap',
            gap: '24px', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ margin: 0, color: '#FFFFFF', fontSize: 'clamp(26px, 3vw, 34px)' }}>Participer à la démonstration</h2>
            <p style={{ margin: '8px 0 0', color: 'rgba(255, 255, 255, 0.75)' }}>
              L’accès se fait sur invitation, avec des comptes de démonstration fictifs.
            </p>
          </div>
          <Button type="button" variant="accent" onClick={() => navigate('/acces')} style={{ minHeight: '52px', padding: '0 26px' }}>
            Accès sur invitation
          </Button>
        </div>
      </section>
    </>
  );
}
