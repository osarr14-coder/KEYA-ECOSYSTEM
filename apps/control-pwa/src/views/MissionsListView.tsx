import { useEffect, useState } from 'react';

import {
  AlertBanner, Button, Icon, Pill, semanticColors, formatServerDateTime,
} from '@keya/design-system';

import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { getCachedMissions, getDraftForMission } from '../db/repository';
import { MISSIONS_UPDATED_EVENT } from '../sync/syncEngine';
import type { Mission, SyncStatus } from '../db/types';

export interface MissionsListViewProps {
  onSelectMission: (missionId: string) => void;
  /** Audit UI R1 (K04, PO-2026-09-27-04) — mode EN LIGNE : liste lue
   * directement sur le serveur (la date serveur fait foi), sans cache local
   * ni statut de synchronisation. Absent : mode hors ligne historique. */
  loadMissions?: () => Promise<Mission[]>;
}

/**
 * Ticket 014 — friction du rapport bout-en-bout : une première inspection
 * et une mission de suivi (réserve déjà ouverte sur ce lot) s'affichaient
 * de façon strictement identique — rien ne permettait à l'inspecteur de
 * savoir, avant d'ouvrir la mission, laquelle des deux il avait devant lui.
 * PAS `StatusBadge` du design system : le type de mission n'est pas un des
 * 5 niveaux Visible Trust (`TrustLevel`), même raisonnement que
 * `SyncStatusIndicator`/`AlertBanner` vs `StatusBadge` (tickets 007/008/010)
 * — un composant local suffit, aucun second consommateur ne le réclame.
 * Référence courte de la réserve (8 premiers caractères de son UUID,
 * convention déjà utilisée par ce type d'identifiant dans l'app) plutôt que
 * `Reserve.description`, qui n'est en pratique jamais renseigné nulle part
 * dans le code actuel (toujours vide) — l'exposer aurait été trompeur.
 */
// Ticket 024 (audit accessibilite) - reprend le token partage du design
// system plutot qu'une couleur redefinie ici en dur (meme piege deja
// documente pour #E5E7EB, ticket 023).
const MISSION_TYPE_STYLE = { fontSize: '13px', color: semanticColors.neutral.textMuted };

function MissionTypeIndicator({ mission }: { mission: Mission }) {
  // Ticket F-076 — pastilles. Ticket F-077 : un recontrôle dont la réserve
  // est levée n'est plus présenté comme une « Première inspection » (il
  // apparaissait en double de la première mission du même jalon).
  if (mission.reserveId) {
    return (
      <span data-testid="mission-type" data-mission-type="follow-up" style={MISSION_TYPE_STYLE}>
        <Pill tone="alert">Mission de suivi — Réserve #{mission.reserveId.slice(0, 8)}</Pill>
      </span>
    );
  }
  if (mission.followUp) {
    return (
      <span data-testid="mission-type" data-mission-type="recontrol" style={MISSION_TYPE_STYLE}>
        <Pill tone="alert">Recontrôle</Pill>
      </span>
    );
  }
  return (
    <span data-testid="mission-type" data-mission-type="first" style={MISSION_TYPE_STYLE}>
      <Pill tone="primary">Première inspection</Pill>
    </span>
  );
}

function MissionSummary({ mission }: { mission: Mission }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Icon name="building" size={18} color={semanticColors.neutral.textMuted} />
        <strong style={{ fontSize: '16px' }}>{mission.lotName}</strong> — {mission.assetName}
      </div>
      <div>{mission.programName} · {mission.milestoneLabel}</div>
      {/* Audit UI R1 (D03) : identifiant et date d'affectation — deux
          missions d'un même jalon ne sont jamais indiscernables. */}
      <div data-testid="mission-identity" style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>
        {`Mission #${mission.id.slice(0, 8)}${mission.assignedAt ? ` · affectée le ${formatServerDateTime(mission.assignedAt)}` : ''}`}
      </div>
    </>
  );
}

/** Audit UI R1 (K05) — résultat de l'avis rendu : conforme ou non, et
 * réserves ouvertes, levées ou maintenues par cet avis. */
export function outcomeSummary(outcome: NonNullable<Mission['outcome']>): string {
  const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
  const parts = [outcome.outcome === 'conforme' ? 'Conforme' : 'Non conforme'];
  if (outcome.reservesOpened) parts.push(`${plural(outcome.reservesOpened, 'réserve')} ouverte${outcome.reservesOpened > 1 ? 's' : ''}`);
  if (outcome.reservesLifted) parts.push(`${plural(outcome.reservesLifted, 'réserve')} levée${outcome.reservesLifted > 1 ? 's' : ''}`);
  if (outcome.reservesMaintained) {
    parts.push(`${plural(outcome.reservesMaintained, 'réserve')} maintenue${outcome.reservesMaintained > 1 ? 's' : ''}`);
  }
  return parts.join(' · ');
}

type LoadState = 'loading' | 'error' | 'ready';

/**
 * Ticket 012 : la liste vient du cache local (`getCachedMissions`),
 * alimenté par `sync/syncEngine.ts::refreshMissions` au retour du réseau —
 * jamais `MOCK_MISSIONS` (ticket 010, retiré). Un cache vide (avant la
 * première synchronisation, ou aucune mission réellement affectée) affiche
 * un état vide explicite, pas une liste figée.
 *
 * Ticket F-033 (audit des états système, vague 1) — deux défauts corrigés :
 * 1. `getCachedMissions()` n'était jamais catché — un échec IndexedDB
 *    devenait une rejection non gérée, invisible à l'écran (ni erreur, ni
 *    chargement infini : la liste restait juste figée sur son état initial
 *    vide, indiscernable d'un « aucune mission » réel). `LoadState` ajoute
 *    un état de chargement ET un état d'erreur explicites, même convention
 *    que le reste du projet (`AlertBanner`).
 * 2. Le statut de synchro par mission utilisait `Promise.all` — l'échec
 *    d'UNE SEULE lecture (`getDraftForMission`) rejetait l'ensemble, privant
 *    TOUTES les autres missions de leur statut déjà connu. `Promise.
 *    allSettled` isole chaque échec à sa propre mission : celle qui échoue
 *    n'affiche simplement aucun statut (comportement déjà accepté pour une
 *    mission jamais entamée), les autres gardent le leur.
 */
export function MissionsListView({ onSelectMission, loadMissions }: MissionsListViewProps) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [statusByMission, setStatusByMission] = useState<Record<string, SyncStatus>>({});
  const [loadState, setLoadState] = useState<LoadState>('loading');
  // Ticket F-033 (vague 3) — même principe que `useApiResource.refetch()` :
  // un compteur inclus dans les deps de l'effet, pour que le bouton
  // "Réessayer" relance le chargement sans dupliquer sa logique.
  const [reloadToken, setReloadToken] = useState(0);

  // Ticket F-069 — relit le cache dès que la synchronisation l'a mis à jour.
  useEffect(() => {
    const reload = () => setReloadToken((token) => token + 1);
    window.addEventListener(MISSIONS_UPDATED_EVENT, reload);
    return () => window.removeEventListener(MISSIONS_UPDATED_EVENT, reload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cachedMissions: Mission[];
      try {
        cachedMissions = loadMissions ? await loadMissions() : await getCachedMissions();
      } catch {
        if (!cancelled) setLoadState('error');
        return;
      }
      if (cancelled) return;
      setMissions(cachedMissions);
      setLoadState('ready');
      if (loadMissions) return;

      const entries = await Promise.allSettled(
        cachedMissions.map(async (mission) => {
          const draft = await getDraftForMission(mission.id);
          return [mission.id, draft?.syncStatus] as const;
        }),
      );
      if (cancelled) return;
      const next: Record<string, SyncStatus> = {};
      for (const entry of entries) {
        if (entry.status !== 'fulfilled') continue;
        const [missionId, status] = entry.value;
        if (status) next[missionId] = status;
      }
      setStatusByMission(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const pending = missions.filter((mission) => !mission.completed);
  const done = missions.filter((mission) => mission.completed);

  return (
    <section aria-label="Mes missions">
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Icon name="clipboard-check" size={22} />
        Mes missions
      </h1>
      {loadState === 'loading' && <p>Chargement…</p>}
      {loadState === 'error' && (
        <AlertBanner
          title="Impossible de charger vos missions."
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      )}
      {loadState === 'ready' && missions.length === 0 && <p>Aucune mission pour le moment.</p>}
      {loadState === 'ready' && missions.length > 0 && pending.length === 0 && (
        <p data-testid="no-pending-missions">Aucune mission à faire : toutes vos inspections sont rendues.</p>
      )}
      {loadState === 'ready' && pending.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {pending.map((mission) => (
            <li key={mission.id}>
              {/* Ticket F-044 — `variant="secondary"`, mêmes tokens de bordure/
                  fond que le reste du projet, mais `style` réécrit la mise en
                  page interne du bouton (colonne, contenu multi-ligne aligné
                  à gauche) : ce n'est pas une ligne de texte simple comme les
                  autres migrations de ce ticket, mais une carte cliquable
                  multi-ligne — même précédent que le bouton de sélection de
                  ligne de `BackofficeView` (F-038), étendu ici. */}
              <Button
                type="button"
                variant="secondary"
                onClick={() => onSelectMission(mission.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '16px',
                  minHeight: '44px',
                  background: semanticColors.neutral.surface,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-start',
                  gap: '8px',
                  fontWeight: 400,
                  color: semanticColors.neutral.text,
                  // Ticket F-054 (refonte visuelle, suite de F-053) — même
                  // traitement que `Card` : ombre + rayon plus prononcé,
                  // cette carte cliquable en a plus besoin qu'un bouton
                  // secondaire ordinaire (aucun autre repère visuel de
                  // "carte" ici, contrairement à Card qui a déjà sa bordure).
                  borderRadius: '6px',
                }}
              >
                <MissionSummary mission={mission} />
                <div><MissionTypeIndicator mission={mission} /></div>
                {statusByMission[mission.id] && (
                  <SyncStatusIndicator status={statusByMission[mission.id]} />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {/* Ticket F-077 — missions déjà rendues : historique en lecture seule,
          séparé de la file « à faire » (elles apparaissaient comme de
          nouvelles missions, en double d'un recontrôle du même jalon). */}
      {loadState === 'ready' && done.length > 0 && (
        <section aria-label="Missions terminées" style={{ marginTop: '24px' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 8px' }}>Terminées</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {done.map((mission) => (
              <li
                key={mission.id}
                data-testid="completed-mission"
                style={{
                  padding: '14px 16px',
                  borderRadius: '6px',
                  border: `1px solid ${semanticColors.neutral.border}`,
                  background: semanticColors.neutral.subtle,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  color: semanticColors.neutral.textMuted,
                }}
              >
                <MissionSummary mission={mission} />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <MissionTypeIndicator mission={mission} />
                  {mission.outcome ? (
                    <Pill tone={mission.outcome.outcome === 'conforme' ? 'success' : 'alert'} data-testid="mission-outcome">
                      {`Avis rendu : ${outcomeSummary(mission.outcome)}`}
                    </Pill>
                  ) : <Pill tone="success">Avis rendu</Pill>}
                </div>
                {mission.outcome && (
                  <div style={{ fontSize: '13px' }}>{`Avis enregistré le ${formatServerDateTime(mission.outcome.recordedAt)}`}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
