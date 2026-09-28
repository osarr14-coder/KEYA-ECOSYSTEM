import { type ReactNode, useEffect, useState } from 'react';

import {
  AlertBanner, ArchiveBanner, BRAND_NAME, Button, DateInput, DateTime, EmptyState, Field, ICON_PATHS, Icon, type IconName, Indicator,
  Input, KeyFigure, MONEY_KIND_LABELS, Money, type MoneyKind, Pill, type PillTone, ReceiptProof, Reference, ReserveCard,
  Select, SimulatedMark, Skeleton, Stepper, TabBar, Timeline, TrustEventLine, TrustLevels, VersionHistory, fetchDemoInstance,
  semanticColors, typography,
} from '@keya/design-system';

/**
 * PO-2026-09-27-20 (A-DS-3) — galerie interne du design system, route
 * `/design-system` d'apps/web, accessible sans compte UNIQUEMENT quand
 * l'instance servie est un environnement de démonstration (`DEMO`). Chaque
 * composant y est montré dans ses états, sur des données entièrement
 * fictives. Aucun appel d'API métier : seule l'instance de démonstration
 * est lue (même requête que le bandeau).
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

type GateState = 'loading' | 'allowed' | 'refused';

export function DesignSystemGalleryRoute() {
  const [gate, setGate] = useState<GateState>('loading');

  useEffect(() => {
    let active = true;
    void fetchDemoInstance(API_BASE_URL).then((instance) => {
      if (active) setGate(instance?.environment === 'DEMO' ? 'allowed' : 'refused');
    });
    return () => { active = false; };
  }, []);

  if (gate === 'loading') {
    return <main style={{ padding: '24px' }}><Skeleton lines={4} label="Vérification de l’environnement" /></main>;
  }
  if (gate === 'refused') {
    return (
      <main style={{ padding: '24px', maxWidth: '720px' }}>
        <h1 style={{ fontSize: '24px' }}>Galerie indisponible</h1>
        <p>La galerie du design system n’est accessible que dans un environnement de démonstration.</p>
      </main>
    );
  }
  return <DesignSystemGallery />;
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      style={{ padding: '32px 0', borderTop: `1px solid ${semanticColors.neutral.border}`, display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div>
        <h2 id={`${id}-title`} style={{ margin: 0, fontSize: '20px' }}>{title}</h2>
        {intro && <p style={{ margin: '6px 0 0', color: semanticColors.neutral.textMuted, maxWidth: '72ch' }}>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: semanticColors.neutral.textMuted }}>{label}</span>
      {children}
    </div>
  );
}

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '20px' } as const;

const COLOR_ROLES: [string, string, string][] = [
  ['Fond', '--keya-neutral-background', 'Fond d’application'],
  ['Surface', '--keya-neutral-surface', 'Tableaux, panneaux'],
  ['Surface discrète', '--keya-neutral-subtle', 'En-têtes de tableau, justificatifs'],
  ['Encre', '--keya-neutral-text', 'Texte courant'],
  ['Encre forte', '--keya-neutral-heading', 'Titres, action primaire sombre, bandeau démo'],
  ['Texte secondaire', '--keya-neutral-text-muted', 'Métadonnées, libellés'],
  ['Bordure', '--keya-neutral-border', 'Séparateurs 1 px'],
  ['Marque et action principale', '--keya-accent-solid', 'Logo, bouton d’action principale — jamais un statut'],
  ['Succès', '--keya-success-text', 'États accomplis'],
  ['Attention', '--keya-alert-text', 'Action attendue de quelqu’un'],
  ['Critique', '--keya-danger-text', 'Refus, blocage, réserve ouverte'],
  ['Information', '--keya-info-text', 'En cours, rien à faire'],
];

/** Glossaire DESIGN_SYSTEM §8.3 et couleur de famille §8.2. */
const GLOSSARY: { object: string; states: [string, string, PillTone][] }[] = [
  {
    object: 'Réservation',
    states: [
      ['requested', 'Demandée', 'neutral'], ['held', 'Bien bloqué', 'alert'], ['reserved', 'Réservée', 'info'],
      ['committed', 'Concrétisée', 'success'], ['expired', 'Expirée', 'danger'], ['cancelled', 'Annulée', 'danger'],
    ],
  },
  {
    object: 'Contrat',
    states: [
      ['draft', 'Brouillon', 'neutral'], ['review', 'En revue', 'info'], ['approved', 'Approuvé', 'alert'],
      ['signed_simulated', 'Signé (simulé)', 'success'],
    ],
  },
  {
    object: 'Jalon',
    states: [
      ['DRAFT', 'Brouillon', 'neutral'], ['SUBMITTED', 'Soumis', 'alert'], ['UNDER_REVIEW', 'En examen', 'info'],
      ['CHANGES_REQUESTED', 'Corrections demandées', 'alert'], ['RESUBMITTED', 'Resoumis', 'info'],
      ['TECHNICALLY_ACCEPTED', 'Accepté techniquement', 'success'],
    ],
  },
  {
    object: 'Décaissement (demande)',
    states: [
      ['draft', 'Brouillon', 'neutral'], ['eligible', 'Éligible', 'alert'], ['executed_sim', 'Exécuté (simulé)', 'info'],
      ['cancelled', 'Annulé', 'danger'],
    ],
  },
  {
    object: 'Mouvement financier',
    states: [
      ['planned', 'Planifié', 'neutral'], ['bank_executed_sim', 'Exécuté par la banque (simulé)', 'info'],
      ['reconciled_sim', 'Rapproché (simulé)', 'success'], ['beneficiary_confirmed_sim', 'Confirmé par le bénéficiaire (simulé)', 'success'],
    ],
  },
  {
    object: 'Signalement de virement',
    states: [
      ['declared', 'Signalé par le client — non encaissé', 'alert'], ['confirmed', 'Traité — encaissement enregistré', 'success'],
      ['rejected', 'Clôturé sans rattachement', 'danger'],
    ],
  },
];

const EVIDENCE = { by: 'Contrôleur Démo (bureau fictif)', at: '2026-09-28T10:12:00Z', version: 'v2', scope: 'Jalon « Fondations », lot A1' };

function DesignSystemGallery() {
  const [tab, setTab] = useState('etats');
  const [day, setDay] = useState('2026-09-28');
  const iconNames = Object.keys(ICON_PATHS) as IconName[];

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: 'clamp(16px, 4vw, 40px)' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: semanticColors.neutral.textMuted }}>
          {`${BRAND_NAME} · usage interne · démonstration`}
        </p>
        <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3vw, 32px)' }}>Galerie du design system</h1>
        <p style={{ margin: 0, maxWidth: '72ch' }}>
          Chaque composant dans ses états, sur des données fictives. Référence : <code style={{ fontFamily: typography.monoFontFamily }}>docs/design/DESIGN_SYSTEM.md</code>{' '}
          (validé, PO-2026-09-27-20).
        </p>
      </header>

      <Section id="couleurs" title="Couleurs" intro="Rôles et jetons du thème clair. Le doré est réservé au logo et à l’action principale.">
        <div style={GRID}>
          {COLOR_ROLES.map(([role, token, usage]) => (
            <div key={token} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span
                aria-hidden="true"
                style={{ width: '40px', height: '40px', flexShrink: 0, borderRadius: '4px', border: `1px solid ${semanticColors.neutral.border}`, background: `var(${token})` }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <strong style={{ fontSize: '14px' }}>{role}</strong>
                <code style={{ fontFamily: typography.monoFontFamily, fontSize: '12px' }}>{token}</code>
                <span style={{ fontSize: '12px', color: semanticColors.neutral.textMuted }}>{usage}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="typographie" title="Typographie" intro="Manrope pour l’interface, Fraunces pour un seul titre par écran, IBM Plex Mono pour les références.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ fontFamily: typography.headingFontFamily, fontSize: '32px', fontWeight: 600, color: semanticColors.neutral.heading }}>Titre de page — 32 px</span>
          <span style={{ fontSize: '20px', fontWeight: 700 }}>Titre de section — 20 px</span>
          <span style={{ fontSize: '16px' }}>Corps mobile — 16 px. Le client lit ses appels de fonds sur téléphone.</span>
          <span style={{ fontSize: '14px' }}>Corps bureau — 14 px. Tableaux denses du gestionnaire et de Finance.</span>
          <span style={{ fontSize: '12px', color: semanticColors.neutral.textMuted }}>Métadonnée — 12 px</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>Chiffres tabulaires : <Money value="30000000" /> · <Money value="1250000" /></span>
          <span>Référence : <Reference value="VIR-SIM-2026-0042" label="Référence bancaire simulée" /></span>
        </div>
      </Section>

      <Section id="marquage" title="Marquage démonstration et simulation" intro="Différencié par la forme (hachures), jamais par une couleur de statut. Le bandeau de démonstration est en haut de cette page.">
        <div style={GRID}>
          <Specimen label="Acte simulé"><SimulatedMark detail="Signature du contrat" /></Specimen>
          <Specimen label="Instance archivée (sous le bandeau démo)"><ArchiveBanner instanceCode="DEMO-CI-20260927-0000" /></Specimen>
        </div>
      </Section>

      <Section id="actions" title="Boutons et actions" intro="Une seule action principale (dorée) par écran. Une action interdite reste visible, désactivée, avec son explication.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <Button type="button" variant="accent">Enregistrer l’encaissement</Button>
          <Button type="button">Ouvrir le dossier</Button>
          <Button type="button" variant="secondary">Annuler</Button>
          <Button type="button" variant="danger">Désactiver le compte</Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <Button type="button" disabled aria-describedby="gallery-forbidden-note">Lever la réserve</Button>
          <span id="gallery-forbidden-note" style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>
            Seul le bureau de contrôle peut lever une réserve.
          </span>
        </div>
      </Section>

      <Section id="champs" title="Champs de formulaire" intro="Libellés explicites, focus visible (anneau 2 px à l’encre).">
        <div style={GRID}>
          <Field label="Référence bancaire simulée"><Input defaultValue="VIR-SIM-2026-0042" /></Field>
          <Field label="Appel à couvrir">
            <Select defaultValue="frais">
              <option value="frais">Frais de réservation — 1 500 000 XOF</option>
              <option value="solde">Complément du premier versement</option>
            </Select>
          </Field>
          <Field label="Montant affecté (erreur)"><Input defaultValue="abc" aria-invalid="true" /></Field>
          <Specimen label="Date au format F06 (PO-2026-09-28-11)">
            <DateInput label="Reçu le" value={day} onChange={setDay} />
          </Specimen>
        </div>
      </Section>

      <Section id="etats" title="États de travail — badges compacts" intro="Libellé + point de couleur. La couleur ne porte jamais seule l’information.">
        <div style={{ overflowX: 'auto' }}>
          <table aria-label="Glossaire des états">
            <thead><tr><th>Objet</th><th>Identifiant</th><th>Affichage</th></tr></thead>
            <tbody>
              {GLOSSARY.flatMap(({ object, states }) => states.map(([id, label, tone], index) => (
                <tr key={`${object}-${id}`}>
                  <td>{index === 0 ? object : ''}</td>
                  <td><code style={{ fontFamily: typography.monoFontFamily, fontSize: '12px' }}>{id}</code></td>
                  <td><Pill tone={tone}>{label}</Pill></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="confiance" title="Niveaux de confiance — échelle" intro="Jamais un badge, une jauge ou un score. Chaque niveau atteint dit qui, quand, sur quelle version, dans quel périmètre.">
        <div style={GRID}>
          <Specimen label="Aucun niveau atteint"><TrustLevels reached={{}} /></Specimen>
          <Specimen label="Déclaré et documenté">
            <TrustLevels reached={{ declared: { ...EVIDENCE, by: 'Constructeur Démo', version: 'v1' }, documented: { ...EVIDENCE, by: 'Constructeur Démo', version: 'v1' } }} />
          </Specimen>
          <Specimen label="Événement isolé (ligne datée, jamais un badge)">
            <TrustEventLine event={{ level: 'documente', actor: 'Constructeur Démo', createdAt: '2026-09-27T20:10:00Z', scope: 'Jalon « Fondations », Lot A1' }} />
          </Specimen>
          <Specimen label="Validé techniquement">
            <TrustLevels
              reached={{
                declared: { ...EVIDENCE, by: 'Constructeur Démo', version: 'v1' },
                documented: { ...EVIDENCE, by: 'Constructeur Démo', version: 'v2' },
                controlled: EVIDENCE,
                verified: EVIDENCE,
                validated: EVIDENCE,
              }}
            />
          </Specimen>
        </div>
      </Section>

      <Section id="montants" title="Montants, dates, références" intro="Six notions distinctes ; le non affecté n’est jamais masqué.">
        <div style={{ overflowX: 'auto' }}>
          <table aria-label="Notions de montant">
            <thead><tr><th>Notion</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
            <tbody>
              {(Object.keys(MONEY_KIND_LABELS) as MoneyKind[]).map((kind) => (
                <tr key={kind}>
                  <td>{MONEY_KIND_LABELS[kind]}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Money kind={kind} value={{ expected: 30000000, received: 1500000, allocated: 1000000, unallocated: 500000, reserved: 4500000, available: 2500000 }[kind]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={GRID}>
          <Specimen label="Horodatage serveur"><DateTime value="2026-09-27T14:05:00Z" /></Specimen>
          <Specimen label="Jour calendaire"><DateTime value="2026-09-28" mode="date" /></Specimen>
          <Specimen label="Identifiant d’instance"><Reference value="DEMO-CI-20260927-205F" label="Identifiant d’instance" /></Specimen>
        </div>
      </Section>

      <Section id="tracabilite" title="Traçabilité" intro="Chronologie en lecture seule, versions jamais supprimées, réserves structurées, justificatif fictif.">
        <div style={{ ...GRID, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))' }}>
          <Specimen label="Chronologie d’audit">
            <Timeline
              entries={[
                { id: 't1', actor: 'Awa Koné', role: 'Gestionnaire', action: 'Contrat approuvé', at: '2026-09-27T14:05:00Z', object: { label: 'Contrat lot A1', version: 'v2' } },
                { id: 't2', actor: 'Moussa Traoré', role: 'Juriste', action: 'Corrections demandées', at: '2026-09-27T11:40:00Z', justification: 'Clause de pénalité à préciser', object: { label: 'Contrat lot A1', version: 'v1' } },
                { id: 't3', actor: 'Client Démo', role: 'Acquéreur', action: 'Réservation demandée', at: '2026-09-26T09:15:00Z' },
              ]}
            />
          </Specimen>
          <Specimen label="Historique de versions">
            <VersionHistory
              versions={[
                { id: 'v2', version: 'v2', statusLabel: 'Approuvé', statusTone: 'alert', at: '2026-09-27T14:05:00Z', author: 'Awa Koné' },
                {
                  id: 'v1', version: 'v1', statusLabel: 'En revue', statusTone: 'info', at: '2026-09-26T16:00:00Z', author: 'Awa Koné',
                  reviews: [{ id: 'r1', author: 'Moussa Traoré', verdict: 'Corrections demandées', at: '2026-09-27T11:40:00Z', text: 'clause de pénalité à préciser' }],
                },
              ]}
            />
          </Specimen>
          <Specimen label="Réserve ouverte (vue constructeur)">
            <ReserveCard
              state="open"
              title="Fissure en pied de mur, façade nord"
              openedAt="2026-09-28T10:12:00Z"
              openedBy="Contrôleur Démo"
              reason="Fissure de 3 mm sur 40 cm"
              expectedAction="Reprendre l’enduit et déposer une photo datée"
              actions={<Button type="button" disabled>Lever la réserve</Button>}
              actionNote="Seul le bureau de contrôle peut lever une réserve."
            />
          </Specimen>
          <Specimen label="Réserve levée">
            <ReserveCard
              state="lifted"
              title="Fissure en pied de mur, façade nord"
              openedAt="2026-09-28T10:12:00Z"
              openedBy="Contrôleur Démo"
              reason="Fissure de 3 mm sur 40 cm"
              expectedAction="Reprendre l’enduit et déposer une photo datée"
              proposedCorrection="Enduit repris, photo déposée (pièce v2)"
              decision={{ by: 'Contrôleur Démo', at: '2026-09-30T08:30:00Z', text: 'Réserve levée après recontrôle' }}
            />
          </Specimen>
          <Specimen label="Justificatif bancaire fictif">
            <ReceiptProof
              bankReference="VIR-SIM-2026-0042"
              amount="1500000"
              currency="XOF"
              receivedOn="2026-09-28"
              recordedBy="Finance Démo"
              recordedAt="2026-09-28T09:00:00Z"
              statusLabel="Exécuté par la banque (simulé)"
              reconciled={false}
              allocations={[{ id: 'a1', label: 'Frais de réservation', amount: '1000000' }]}
              unallocatedAmount="500000"
            />
          </Specimen>
        </div>
      </Section>

      <Section id="indicateurs" title="Indicateurs et chiffres clés" intro="Numérateur et dénominateur visibles ; dénominateur nul → « Non applicable ». Zéros discrets.">
        <div style={GRID}>
          <Indicator label="Jalons acceptés techniquement" numerator={3} denominator={4} unit="jalons déclarés" onOpenSources={() => {}} />
          <Indicator label="Réserves levées" numerator={0} denominator={0} unit="réserves ouvertes" />
          <KeyFigure label="Signalements à traiter" value={2} tone="alert" onClick={() => {}} />
          <KeyFigure label="Dossiers concrétisés" value={0} />
        </div>
      </Section>

      <Section id="ecrans" title="États d’écran" intro="Chargement par squelettes, vide avec prochaine action, erreur compréhensible, succès sobre.">
        <div style={GRID}>
          <Specimen label="Chargement"><Skeleton lines={3} /></Specimen>
          <Specimen label="Vide">
            <EmptyState message="Aucun encaissement enregistré. Enregistrez le premier depuis le relevé fictif." action={<Button type="button" variant="secondary">Enregistrer</Button>} />
          </Specimen>
          <Specimen label="Erreur">
            <AlertBanner title="Impossible de charger les encaissements." onRetry={() => {}} retryLabel="Réessayer" />
          </Specimen>
          <Specimen label="Succès">
            <p role="status" style={{ margin: 0, display: 'flex', gap: '8px', alignItems: 'center', color: semanticColors.success.text }}>
              <Icon name="check-circle" size={16} /> Encaissement enregistré (simulé).
            </p>
          </Specimen>
        </div>
      </Section>

      <Section id="navigation" title="Navigation et parcours">
        <TabBar
          aria-label="Exemple d’onglets"
          tabs={[{ id: 'etats', label: 'États' }, { id: 'versions', label: 'Versions' }, { id: 'journal', label: 'Journal' }]}
          activeTabId={tab}
          onChange={setTab}
        />
        <Stepper
          aria-label="Étapes de l’acquisition"
          steps={[
            { id: 'reservation', label: 'Réservation', state: 'done' },
            { id: 'contrat', label: 'Contrat signé (simulé)', state: 'current' },
            { id: 'chantier', label: 'Suivi du chantier', state: 'upcoming' },
          ]}
        />
      </Section>

      <Section id="icones" title="Icônes" intro="Tracés Lucide (licence ISC), trait 1,5 ; une icône par concept.">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
          {iconNames.map((name) => (
            <li key={name} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
              <Icon name={name} size={20} />
              <code style={{ fontFamily: typography.monoFontFamily }}>{name}</code>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  );
}
