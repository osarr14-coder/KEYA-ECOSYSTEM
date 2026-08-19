import { useState } from 'react';

import { AlertBanner, semanticColors } from '@keya/design-system';

/**
 * MAQUETTE VISUELLE UNIQUEMENT — ticket 025.
 *
 * Aucun appel API réel : ce fichier n'importe ni `useApiClient` ni
 * `ApiClientContext`, volontairement, pour qu'il soit structurellement
 * impossible qu'un futur import distrait y glisse une requête réelle sans
 * que ce commentaire mente. Toutes les données ci-dessous sont statiques
 * (`MOCK_LOTS`) — aucun état ne persiste, aucune action n'écrit quoi que ce
 * soit. Les boutons d'action sont rendus `disabled`, avec un `title`
 * explicite, pour qu'un survol ne laisse jamais croire qu'ils font quelque
 * chose.
 *
 * Périmètre reflété ici : UNIQUEMENT ce qui est déjà stable et fusionné au
 * ticket 022 (`apps/procurement`) — création d'un `Devis` par
 * `admin_keyimmo`, verrouillage (`lock_devis`), liste des devis d'un lot
 * avec montants. Le statut « gagnant » d'un candidat (dépend du ticket 024,
 * réconciliation devis/ajustement, encore en cours ailleurs — voir
 * `024-reconciliation-devis-ajustement.md`, worktree dédié) n'est PAS
 * représenté : le comportement exact (statut dérivé au moment du
 * verrouillage, ou seulement après réconciliation réussie du
 * `DevisAjustement`) n'est pas encore stabilisé côté backend. Voir le
 * bandeau dédié en bas de cet écran.
 */

interface MockDevisRow {
  id: string;
  candidateOrganizationName: string;
  amountLabel: string;
  loggedByEmail: string;
  createdAtLabel: string;
  locked: boolean;
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
        loggedByEmail: 'admin@keyimmo.example',
        createdAtLabel: '02/03/2026 09:14',
        locked: true,
      },
      {
        id: 'mock-devis-2',
        candidateOrganizationName: 'Fondation Solide SA',
        amountLabel: '13 100 000 FCFA',
        loggedByEmail: 'admin@keyimmo.example',
        createdAtLabel: '03/03/2026 11:47',
        locked: false,
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
        loggedByEmail: 'admin@keyimmo.example',
        createdAtLabel: '05/03/2026 14:02',
        locked: false,
      },
    ],
  },
];

/**
 * PAS `StatusBadge` du design system : `candidat`/`verrouillé` n'est pas un
 * des 5 niveaux Visible Trust (`TrustLevel`) — même raisonnement déjà
 * appliqué à `MissionTypeIndicator`/`SyncStatusIndicator` (CONTROL PWA,
 * CLAUDE.md) qu'à `AlertBanner` vs `StatusBadge` (ticket 008). Composant
 * local à cette maquette : s'il fallait le rendre réel au câblage de ce
 * ticket, il vivrait dans `apps/web`, pas dans le design system, tant
 * qu'aucun second consommateur ne le réclame (même discipline que les deux
 * précédents).
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

function DevisRow({ row, lotAlreadyLocked }: { row: MockDevisRow; lotAlreadyLocked: boolean }) {
  return (
    <tr style={{ borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
      <td style={{ padding: '10px 12px' }}>{row.candidateOrganizationName}</td>
      <td style={{ padding: '10px 12px' }}>{row.amountLabel}</td>
      <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{row.loggedByEmail}</td>
      <td style={{ padding: '10px 12px', color: semanticColors.neutral.textMuted }}>{row.createdAtLabel}</td>
      <td style={{ padding: '10px 12px' }}><DevisStatusIndicator locked={row.locked} /></td>
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
  const [showReconciliationDetail, setShowReconciliationDetail] = useState(false);

  return (
    <section aria-label="Devis / Appels d'offres">
      <div style={{ marginBottom: '16px' }}>
        <AlertBanner title="Maquette visuelle — aucune donnée réelle">
          Écran non fonctionnel : données statiques, aucun appel API. Reproduit uniquement
          ce qui est déjà stable et fusionné (ticket 022 — création, verrouillage, liste
          des devis d'un lot).
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
        <h3 style={{ marginTop: 0 }}>Statut « gagnant » — à câbler une fois le ticket 024 fusionné</h3>
        <p>
          Cette maquette n&apos;affiche volontairement AUCUN statut « gagnant » pour un
          candidat. Le comportement exact (statut dérivé au moment de la sélection, ou
          seulement après réconciliation réussie du <code>DevisAjustement</code>) dépend du
          ticket 024 (réconciliation devis / ajustement), encore en cours dans un worktree
          séparé au moment de cette maquette — non fusionné dans master.
        </p>
        <button
          type="button"
          onClick={() => setShowReconciliationDetail((current) => !current)}
          aria-expanded={showReconciliationDetail}
        >
          {showReconciliationDetail ? 'Masquer' : 'Voir'} le détail de ce qui reste à câbler
        </button>
        {showReconciliationDetail && (
          <ul style={{ marginTop: '12px' }}>
            <li>Séquencement du statut « gagnant » (au verrouillage vs. post-réconciliation) — dépend de la décision de conception du ticket 024.</li>
            <li>Affichage de la marge disponible et de l&apos;écart de l&apos;offre retenue — dépend du modèle `DevisAjustement` du ticket 024.</li>
            <li>Traitement visuel du cas limite « écart = marge exacte » (accepté, marge résultante nulle) vs. « écart {'>'} marge » (refusé) — dépend des critères d&apos;acceptation du ticket 024.</li>
            <li>Aucun appel réseau vers un endpoint de réconciliation n&apos;existe dans cette maquette — à ajouter une fois l&apos;API réelle fusionnée.</li>
          </ul>
        )}
      </div>
    </section>
  );
}
