import { useState } from 'react';

import { AlertBanner, semanticColors } from '@keya/design-system';

/**
 * MAQUETTE VISUELLE UNIQUEMENT — ticket 025 (mise à jour ticket 026 : statut
 * « gagnant » candidat, une fois le ticket 024 fusionné et son contrat API
 * vérifié directement dans `backend/apps/procurement/{services,serializers,
 * views}.py`).
 *
 * Aucun appel API réel : ce fichier n'importe ni `useApiClient` ni
 * `ApiClientContext`, volontairement, pour qu'il soit structurellement
 * impossible qu'un futur import distrait y glisse une requête réelle sans
 * que ce commentaire mente. Toutes les données ci-dessous sont statiques
 * (`MOCK_LOTS`) — aucun état ne persiste, aucune action n'écrit quoi que ce
 * soit. Les boutons d'action sont rendus `disabled`, avec un `title`
 * explicite, pour qu'un survol ne laisse jamais croire qu'ils font quelque
 * chose. Toute valeur affichée (montants, marge résultante) est une chaîne
 * PRÉ-FORMATÉE codée en dur dans `MOCK_LOTS` — jamais un calcul fait ici,
 * même sur des données fictives : même discipline « aucun calcul frontend »
 * que le reste du projet, sans exception pour une maquette.
 *
 * Périmètre reflété ici : ce qui est stable et fusionné aux tickets 022
 * (création, verrouillage, liste des devis) ET 024 (marge_estimee,
 * DevisAjustement, statut « gagnant » gaté côté candidat). Contrat API
 * vérifié directement dans le code réel avant d'écrire cette maquette
 * (jamais supposé) :
 * - `DevisAdminSerializer` (`GET /api/procurement/admin/lots/{id}/devis/`)
 *   expose le statut RÉEL (`get_devis_status`, jamais gaté) — un admin voit
 *   « Verrouillé » dès l'instant du verrouillage, y compris avant toute
 *   réconciliation. C'est le statut représenté par `DevisStatusIndicator`
 *   ci-dessous, INCHANGÉ depuis le ticket 025.
 * - `DevisCandidateSerializer.get_status` (`GET /api/procurement/
 *   my-candidatures/`) appelle `get_candidate_visible_devis_status` : un
 *   devis verrouillé reste vu `candidat` par SON candidat tant qu'AUCUN
 *   `DevisAjustement` n'existe pour lui — le statut « gagnant » n'apparaît
 *   qu'après au moins un ajustement accepté (un ajustement refusé, 409, ne
 *   crée jamais de ligne). C'est ce second statut, DISTINCT du premier, que
 *   `CandidateVisibleStatusNote` représente ci-dessous — jamais fusionné
 *   avec `DevisStatusIndicator`, précisément parce que ce sont deux
 *   AUDIENCES différentes qui voient potentiellement deux choses
 *   différentes au même instant (l'admin sait déjà, le candidat pas
 *   encore).
 */

interface MockAjustement {
  id: string;
  ecartLabel: string;
  favorable: boolean;
  margeResultanteLabel: string;
  createdByEmail: string;
  createdAtLabel: string;
}

interface MockDevisRow {
  id: string;
  candidateOrganizationName: string;
  amountLabel: string;
  margeEstimeeLabel: string;
  loggedByEmail: string;
  createdAtLabel: string;
  locked: boolean;
  /** Vide tant qu'aucune réconciliation n'a eu lieu — c'est PRÉCISÉMENT ce
   * qui gate le statut « gagnant » côté candidat (ticket 024), jamais le
   * verrouillage lui-même. */
  ajustements: MockAjustement[];
}

interface MockLot {
  id: string;
  name: string;
  assetName: string;
  programName: string;
  devis: MockDevisRow[];
}

const MOCK_LOTS: MockLot[] = [
  {
    id: 'mock-lot-1',
    name: 'Lot A12',
    assetName: 'Résidence Ker',
    programName: 'Programme Keur Massar',
    devis: [
      {
        id: 'mock-devis-1',
        candidateOrganizationName: 'Bâti Sénégal SARL',
        amountLabel: '12 500 000 FCFA',
        margeEstimeeLabel: '1 500 000 FCFA',
        loggedByEmail: 'admin@keyimmo.example',
        createdAtLabel: '02/03/2026 09:14',
        locked: true,
        // Verrouillé ET déjà réconcilié : le candidat voit désormais
        // "Gagnant" — cumul signé (ticket 024, point A) : un écart
        // favorable PUIS un écart défavorable, la marge résultante de
        // chaque ligne reflète le cumul, jamais marge_estimee seule.
        ajustements: [
          {
            id: 'mock-ajustement-1',
            ecartLabel: '-200 000 FCFA',
            favorable: true,
            margeResultanteLabel: '1 700 000 FCFA',
            createdByEmail: 'admin@keyimmo.example',
            createdAtLabel: '10/03/2026 10:05',
          },
          {
            id: 'mock-ajustement-2',
            ecartLabel: '+300 000 FCFA',
            favorable: false,
            margeResultanteLabel: '1 400 000 FCFA',
            createdByEmail: 'admin@keyimmo.example',
            createdAtLabel: '12/03/2026 16:22',
          },
        ],
      },
      {
        id: 'mock-devis-2',
        candidateOrganizationName: 'Fondation Solide SA',
        amountLabel: '13 100 000 FCFA',
        margeEstimeeLabel: '1 100 000 FCFA',
        loggedByEmail: 'admin@keyimmo.example',
        createdAtLabel: '03/03/2026 11:47',
        locked: false,
        ajustements: [],
      },
    ],
  },
  {
    id: 'mock-lot-2',
    name: 'Lot B03',
    assetName: 'Résidence Almadies View',
    programName: 'Programme Almadies',
    devis: [
      {
        id: 'mock-devis-3',
        candidateOrganizationName: 'Bâti Sénégal SARL',
        amountLabel: '8 900 000 FCFA',
        margeEstimeeLabel: '900 000 FCFA',
        loggedByEmail: 'admin@keyimmo.example',
        createdAtLabel: '05/03/2026 14:02',
        locked: false,
        ajustements: [],
      },
    ],
  },
  {
    id: 'mock-lot-3',
    name: 'Lot C07',
    assetName: 'Résidence Ngor Plage',
    programName: 'Programme Ngor',
    devis: [
      {
        id: 'mock-devis-4',
        candidateOrganizationName: 'Chantiers Réunis SA',
        amountLabel: '15 800 000 FCFA',
        margeEstimeeLabel: '2 000 000 FCFA',
        loggedByEmail: 'admin@keyimmo.example',
        createdAtLabel: '08/03/2026 08:30',
        // Verrouillé mais AUCUN ajustement encore : cas volontairement
        // distinct du Lot A12 — le candidat voit encore "Candidat", jamais
        // "Gagnant", malgré un verrouillage déjà effectif côté admin.
        locked: true,
        ajustements: [],
      },
    ],
  },
];

/**
 * PAS `StatusBadge` du design system : `candidat`/`verrouillé` n'est pas un
 * des 5 niveaux Visible Trust (`TrustLevel`), même raisonnement déjà
 * appliqué à `MissionTypeIndicator`/`SyncStatusIndicator` (CONTROL PWA,
 * CLAUDE.md) qu'à `AlertBanner` vs `StatusBadge` (ticket 008). Composant
 * local à cette maquette. Représente le statut RÉEL (`get_devis_status`),
 * TOUJOURS exact pour l'admin — inchangé depuis le ticket 025.
 */
function DevisStatusIndicator({ locked }: { locked: boolean }) {
  return (
    <span
      data-testid="devis-status"
      data-status={locked ? 'verrouille' : 'candidat'}
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '999px',
        fontSize: '13px',
        fontWeight: 600,
        border: `1px solid ${locked ? semanticColors.neutral.text : semanticColors.neutral.border}`,
        color: locked ? semanticColors.neutral.text : semanticColors.neutral.textMuted,
      }}
    >
      {locked ? 'Verrouillé' : 'Candidat'}
    </span>
  );
}

/**
 * Ticket 026 — représente `get_candidate_visible_devis_status`
 * (`apps/procurement/services.py`) : DISTINCT de `DevisStatusIndicator`
 * ci-dessus à dessein. Un devis peut être RÉELLEMENT verrouillé (l'admin le
 * sait immédiatement) tout en restant vu `candidat` par SON candidat tant
 * qu'aucun `DevisAjustement` n'existe pour lui — les deux composants
 * peuvent donc afficher des informations différentes pour la MÊME ligne, au
 * MÊME instant, et c'est intentionnel : fusionner les deux aurait caché
 * cette nuance qui est précisément le sujet du ticket 024.
 */
function CandidateVisibleStatusNote({ row }: { row: MockDevisRow }) {
  if (!row.locked) return null;

  const isGagnant = row.ajustements.length > 0;

  return (
    <p
      data-testid="candidate-visible-status"
      data-status={isGagnant ? 'gagnant' : 'candidat'}
      style={{ margin: '4px 0 0', fontSize: '13px', color: semanticColors.neutral.textMuted }}
    >
      Vue candidat : {isGagnant ? (
        <strong style={{ color: semanticColors.neutral.text }}>« Gagnant »</strong>
      ) : (
        <>encore « Candidat » (aucune réconciliation acceptée)</>
      )}
    </p>
  );
}

function AjustementsPanel({ devis }: { devis: MockDevisRow }) {
  if (!devis.locked) return null;

  return (
    <div style={{ marginTop: '8px', paddingLeft: '12px', borderLeft: `2px solid ${semanticColors.neutral.border}` }}>
      <p style={{ margin: '0 0 4px', fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        Marge estimée : {devis.margeEstimeeLabel}
      </p>
      {devis.ajustements.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px' }}>Aucun ajustement enregistré pour l&apos;instant.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: '13px', marginBottom: '8px' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: semanticColors.neutral.textMuted }}>
              <th style={{ padding: '4px 8px' }}>Écart</th>
              <th style={{ padding: '4px 8px' }}>Marge résultante</th>
              <th style={{ padding: '4px 8px' }}>Saisi par</th>
              <th style={{ padding: '4px 8px' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {devis.ajustements.map((ajustement) => (
              <tr key={ajustement.id}>
                <td style={{ padding: '4px 8px' }}>
                  {ajustement.ecartLabel} ({ajustement.favorable ? 'favorable' : 'défavorable'})
                </td>
                <td style={{ padding: '4px 8px' }}>{ajustement.margeResultanteLabel}</td>
                <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>{ajustement.createdByEmail}</td>
                <td style={{ padding: '4px 8px', color: semanticColors.neutral.textMuted }}>{ajustement.createdAtLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        type="button"
        disabled
        title="Maquette — action non fonctionnelle (l'API réelle existe déjà, ticket 024 : POST /api/procurement/devis/{id}/ajustements/)"
        style={{ opacity: 0.5, cursor: 'not-allowed', fontSize: '13px' }}
      >
        Enregistrer un ajustement
      </button>
    </div>
  );
}

function DevisRow({ row, lotAlreadyLocked }: { row: MockDevisRow; lotAlreadyLocked: boolean }) {
  return (
    <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
      <td style={{ padding: '10px 12px' }}>{row.candidateOrganizationName}</td>
      <td style={{ padding: '10px 12px' }}>{row.amountLabel}</td>
      <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{row.loggedByEmail}</td>
      <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{row.createdAtLabel}</td>
      <td style={{ padding: '10px 12px' }}>
        <DevisStatusIndicator locked={row.locked} />
        <CandidateVisibleStatusNote row={row} />
        <AjustementsPanel devis={row} />
      </td>
      <td style={{ padding: '10px 12px' }}>
        <button
          type="button"
          disabled
          title="Maquette — action non fonctionnelle (l'API réelle existe déjà, ticket 022 : POST /api/procurement/devis/{id}/lock/)"
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
        >
          {row.locked ? 'Verrouillé' : lotAlreadyLocked ? 'Lot déjà verrouillé' : 'Verrouiller'}
        </button>
      </td>
    </tr>
  );
}

function LotDevisPanel({ lot }: { lot: MockLot }) {
  const lotAlreadyLocked = lot.devis.some((row) => row.locked);

  return (
    <section
      aria-label={`Devis pour ${lot.name}`}
      style={{
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px',
      }}
    >
      <h3 style={{ marginTop: 0 }}>{lot.name}</h3>
      <p style={{ margin: '0 0 12px', color: semanticColors.neutral.textMuted }}>
        {lot.assetName} — {lot.programName}
      </p>

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '14px' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}`, textAlign: 'left' }}>
            <th style={{ padding: '10px 12px' }}>Organisation candidate</th>
            <th style={{ padding: '10px 12px' }}>Montant</th>
            <th style={{ padding: '10px 12px' }}>Saisi par</th>
            <th style={{ padding: '10px 12px' }}>Date</th>
            <th style={{ padding: '10px 12px' }}>Statut</th>
            <th style={{ padding: '10px 12px' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {lot.devis.map((row) => (
            <DevisRow key={row.id} row={row} lotAlreadyLocked={lotAlreadyLocked} />
          ))}
        </tbody>
      </table>

      <button
        type="button"
        disabled
        title="Maquette — action non fonctionnelle (l'API réelle existe déjà, ticket 022 : POST /api/procurement/devis/)"
        style={{ marginTop: '12px', opacity: 0.5, cursor: 'not-allowed' }}
      >
        Saisir un devis pour ce lot
      </button>
    </section>
  );
}

export function DevisAppelOffreMockup() {
  const [showRemainingWork, setShowRemainingWork] = useState(false);

  return (
    <section aria-label="Devis / Appels d'offres">
      <div style={{ marginBottom: '16px' }}>
        <AlertBanner title="Maquette visuelle — aucune donnée réelle">
          Écran non fonctionnel : données statiques, aucun appel API. Le statut « gagnant »
          affiché ci-dessous reflète le comportement RÉEL du ticket 024 (gating post-
          réconciliation) — vérifié directement dans le code backend avant d'écrire cette
          maquette, jamais supposé.
        </AlertBanner>
      </div>

      <h2>Devis par lot</h2>
      {MOCK_LOTS.map((lot) => (
        <LotDevisPanel key={lot.id} lot={lot} />
      ))}

      <div
        style={{
          border: `1px dashed ${semanticColors.neutral.border}`,
          borderRadius: '8px',
          padding: '16px',
          marginTop: '8px',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Ce qui reste à câbler pour rendre cet écran réel</h3>
        <p>
          Le statut « gagnant » (gaté par la réconciliation, ticket 024) est désormais
          représenté visuellement — <code>Lot A12</code> montre un devis verrouillé ET
          réconcilié (« Gagnant » visible côté candidat), <code>Lot C07</code> montre un
          devis verrouillé SANS réconciliation (encore « Candidat » côté candidat), pour
          que les deux états réels soient visibles côte à côte.
        </p>
        <button
          type="button"
          onClick={() => setShowRemainingWork((current) => !current)}
          aria-expanded={showRemainingWork}
        >
          {showRemainingWork ? 'Masquer' : 'Voir'} le détail de ce qui reste à câbler
        </button>
        {showRemainingWork && (
          <ul style={{ marginTop: '12px' }}>
            <li>Aucun appel réseau réel nulle part dans ce fichier — toutes les données sont statiques (<code>MOCK_LOTS</code>).</li>
            <li>Formulaire réel de saisie d&apos;un devis/ajustement (actuellement un bouton désactivé).</li>
            <li>Traitement du refus (409, écart au-delà de la marge disponible) — testé côté backend (ticket 024), non simulé ici (aucune saisie possible dans une maquette).</li>
            <li>Traitement du cas limite exact (écart == marge disponible → accepté, marge résultante nulle) — également non simulable sans formulaire réel.</li>
          </ul>
        )}
      </div>
    </section>
  );
}
