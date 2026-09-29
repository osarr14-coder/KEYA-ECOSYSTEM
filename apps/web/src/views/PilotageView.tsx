import { type ReactNode, useState } from 'react';

import {
  ApiErrorBanner, Button, Card, CountIndicator, Indicator, PageHeader, Pill, formatServerDateTime, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type {
  DossierLink, MilestoneSource, OutflowTotals, PilotageKey, ReceiptSource, RequiredPieceSource, ReserveSource,
} from '../api/types';
import { useApiResource } from '../api/useApiResource';
import type { NavigationTarget } from './TodayView';

/**
 * Lot 4 — pilotage minimal du gestionnaire (PO-2026-09-28-46, CDC §9.2
 * étape 10, §9.3). Les chiffres sont calculés par le serveur sur l'instance
 * active ; chacun ouvre ses sources. Dénominateur nul → « Non applicable »
 * (`Indicator`). Les sorties ne sont données qu'en total (A3,
 * PO-2026-09-28-66) : le détail reste à Finance.
 */

const SOURCE_TITLES: Record<PilotageKey, string> = {
  jalons: 'Jalons soumis et leur dernier avis',
  entrees: 'Encaissements exécutés',
  sorties: 'Décaissements exécutés (total)',
  reserves: 'Réserves et leur ancienneté',
  pieces: 'Pièces exigées des jalons déclarés',
};

function formatAmount(value: string, currency: string) {
  return `${Number(value).toLocaleString('fr-FR')} ${currency}`;
}

function days(value: number) {
  return `${value} j`;
}

function DossierButton({ dossier, label, onNavigate }: {
  dossier: DossierLink | null; label: string; onNavigate: (target: NavigationTarget) => void;
}) {
  if (!dossier) return <span style={{ color: semanticColors.neutral.textMuted }}>—</span>;
  return (
    <Button type="button" variant="secondary" onClick={() => onNavigate({ tab: 'reservations', reservationId: dossier.id })} aria-label={`Ouvrir le dossier — ${label}`}>
      Ouvrir le dossier
    </Button>
  );
}

function SourceTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {head.map((cell) => (cell ? <th key={cell}>{cell}</th> : <th key="actions" aria-label="Actions" />))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function MilestoneRows({ rows, onNavigate }: { rows: MilestoneSource[]; onNavigate: (target: NavigationTarget) => void }) {
  if (rows.length === 0) return <p style={{ margin: 0 }}>Aucun jalon soumis dans l’instance active.</p>;
  return (
    <SourceTable head={['Lot', 'Jalon', 'État', 'Dernier avis', '']}>
      {rows.map((row) => (
        <tr key={`${row.lot}-${row.milestone}`}>
          <td>{row.lot}</td>
          <td>{row.milestone}</td>
          <td><Pill tone={row.technically_accepted ? 'success' : 'neutral'}>{row.status_label}</Pill></td>
          <td>
            {row.last_opinion
              ? `${row.last_opinion.outcome_label} — ${row.last_opinion.by}, ${formatServerDateTime(row.last_opinion.at)}`
              : 'Pas encore d’avis'}
          </td>
          <td><DossierButton dossier={row.dossier} label={`${row.lot}, ${row.milestone}`} onNavigate={onNavigate} /></td>
        </tr>
      ))}
    </SourceTable>
  );
}

function ReceiptRows({ rows, onNavigate }: { rows: ReceiptSource[]; onNavigate: (target: NavigationTarget) => void }) {
  if (rows.length === 0) return <p style={{ margin: 0 }}>Aucun encaissement exécuté dans l’instance active.</p>;
  return (
    <SourceTable head={['Dossier', 'Référence (simulée)', 'Montant', 'Reçu le', 'État', '']}>
      {rows.map((row) => (
        <tr key={row.reference}>
          <td>{`${row.client} · ${row.lot}`}</td>
          <td>{row.reference}</td>
          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatAmount(row.amount, row.currency)}</td>
          <td>{new Date(`${row.received_on}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}</td>
          <td><Pill tone={row.reconciled ? 'success' : 'info'}>{row.reconciled ? 'Rapproché (simulé)' : 'À rapprocher'}</Pill></td>
          <td><DossierButton dossier={row.dossier} label={`${row.client}, ${row.lot}`} onNavigate={onNavigate} /></td>
        </tr>
      ))}
    </SourceTable>
  );
}

function OutflowSummary({ totals }: { totals: OutflowTotals }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
      <dt>Exécutés</dt>
      <dd style={{ margin: 0 }}>{`${totals.executed} — ${formatAmount(totals.executed_amount, totals.currency)}`}</dd>
      <dt>Rapprochés</dt>
      <dd style={{ margin: 0 }}>{`${totals.reconciled} — ${formatAmount(totals.reconciled_amount, totals.currency)}`}</dd>
      <dt>Détail</dt>
      <dd style={{ margin: 0 }} data-testid="outflow-detail">{totals.detail}</dd>
    </dl>
  );
}

function ReserveRows({ rows, onNavigate }: { rows: ReserveSource[]; onNavigate: (target: NavigationTarget) => void }) {
  if (rows.length === 0) return <p style={{ margin: 0 }}>Aucune réserve dans l’instance active.</p>;
  return (
    <SourceTable head={['Lot', 'Jalon', 'Motif', 'État', 'Ouverte le', 'Ancienneté', '']}>
      {rows.map((row) => (
        <tr key={`${row.lot}-${row.opened_at}`}>
          <td>{row.lot}</td>
          <td>{row.milestone}</td>
          <td>{row.motif}</td>
          <td><Pill tone={row.is_open ? 'alert' : row.is_lifted ? 'success' : 'neutral'}>{row.status_label}</Pill></td>
          <td>{`${formatServerDateTime(row.opened_at)} — ${row.opened_by}`}</td>
          <td>{row.is_open ? `${days(row.age_days)} (ouverte)` : row.is_lifted ? `${days(row.age_days)} avant levée` : days(row.age_days)}</td>
          <td><DossierButton dossier={row.dossier} label={`${row.lot}, ${row.milestone}`} onNavigate={onNavigate} /></td>
        </tr>
      ))}
    </SourceTable>
  );
}

function examinedText(examined: boolean | null) {
  if (examined === null) return 'Pas encore d’avis';
  return examined ? 'Examinée au dernier avis' : 'Non examinée au dernier avis';
}

function PieceRows({ rows, onNavigate }: { rows: RequiredPieceSource[]; onNavigate: (target: NavigationTarget) => void }) {
  if (rows.length === 0) return <p style={{ margin: 0 }}>Aucun jalon déclaré : aucune pièce n’est encore exigée.</p>;
  return (
    <>
      <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>
        « Déposée » dit qu’un fichier a été joint pour cette pièce, pas qu’il est conforme : seul le contrôleur l’examine.
      </p>
      <SourceTable head={['Lot', 'Jalon', 'Pièce exigée', 'Présence', 'Examen du contrôleur', '']}>
        {rows.map((row) => (
          <tr key={`${row.lot}-${row.milestone}-${row.code}`}>
            <td>{row.lot}</td>
            <td>{row.milestone}</td>
            <td>{row.label}</td>
            <td>
              <Pill tone={row.deposited ? 'info' : 'alert'}>
                {row.deposited && row.deposited_at ? `Déposée le ${formatServerDateTime(row.deposited_at)}` : 'Manquante'}
              </Pill>
            </td>
            <td>{examinedText(row.examined)}</td>
            <td>
              <DossierButton dossier={row.dossier} label={`${row.lot}, ${row.milestone}, ${row.label}`} onNavigate={onNavigate} />
            </td>
          </tr>
        ))}
      </SourceTable>
    </>
  );
}

function Sources({ sourceKey, onNavigate }: { sourceKey: PilotageKey; onNavigate: (target: NavigationTarget) => void }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getPilotageSources(sourceKey), [sourceKey]);
  // Jamais les sources d'un autre indicateur : leur forme diffère (liste
  // ou total), même pendant le rechargement qui suit un changement de clé.
  const ready = state.status === 'success' && state.data.key === sourceKey;
  return (
    <Card title={`Sources — ${SOURCE_TITLES[sourceKey]}`} icon="list-checks">
      <div data-testid="pilotage-sources" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {(state.status === 'loading' || (state.status === 'success' && !ready)) && (
          <p style={{ margin: 0 }}>Chargement des sources…</p>
        )}
        {state.status === 'error' && <ApiErrorBanner error={state.error} title="Impossible de charger les sources." />}
        {ready && state.status === 'success' && sourceKey === 'jalons' && (
          <MilestoneRows rows={state.data.sources as MilestoneSource[]} onNavigate={onNavigate} />
        )}
        {ready && state.status === 'success' && sourceKey === 'entrees' && (
          <ReceiptRows rows={state.data.sources as ReceiptSource[]} onNavigate={onNavigate} />
        )}
        {ready && state.status === 'success' && sourceKey === 'sorties' && <OutflowSummary totals={state.data.sources as OutflowTotals} />}
        {ready && state.status === 'success' && sourceKey === 'reserves' && (
          <ReserveRows rows={state.data.sources as ReserveSource[]} onNavigate={onNavigate} />
        )}
        {ready && state.status === 'success' && sourceKey === 'pieces' && (
          <PieceRows rows={state.data.sources as RequiredPieceSource[]} onNavigate={onNavigate} />
        )}
      </div>
    </Card>
  );
}

export function PilotageView({ onNavigate }: { onNavigate: (target: NavigationTarget) => void }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getPilotageIndicators(), []);
  const [selected, setSelected] = useState<PilotageKey | null>(null);

  return (
    <section aria-label="Pilotage" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Pilotage"
        subtitle="Indicateurs calculés sur l’instance de démonstration active (données fictives). Chaque chiffre ouvre ses sources."
      />
      {state.status === 'loading' && <p>Calcul des indicateurs…</p>}
      {state.status === 'error' && <ApiErrorBanner error={state.error} title="Impossible de calculer les indicateurs." />}
      {state.status === 'success' && (() => {
        const { jalons, entrees, sorties, reserves, pieces } = state.data.indicators;
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '16px' }}>
              <Indicator
                label={jalons.label} numerator={jalons.numerator} denominator={jalons.denominator} unit={jalons.unit}
                note={`Acceptations techniques en cours : ${jalons.technically_accepted}`}
                onOpenSources={() => setSelected('jalons')} data-testid="indicator-jalons"
              />
              <Indicator
                label={entrees.label} numerator={entrees.numerator} denominator={entrees.denominator} unit={entrees.unit}
                onOpenSources={() => setSelected('entrees')} data-testid="indicator-entrees"
              />
              <Indicator
                label={sorties.label} numerator={sorties.numerator} denominator={sorties.denominator} unit={sorties.unit}
                note={`Total exécuté : ${formatAmount(sorties.executed_amount, sorties.currency)}`}
                onOpenSources={() => setSelected('sorties')} data-testid="indicator-sorties"
              />
              <CountIndicator
                label={reserves.label}
                counts={[
                  { label: reserves.open > 1 ? 'ouvertes' : 'ouverte', value: reserves.open },
                  { label: reserves.lifted > 1 ? 'levées' : 'levée', value: reserves.lifted },
                ]}
                detail={reserves.oldest_open_days === null ? undefined : `La plus ancienne ouverte : ${days(reserves.oldest_open_days)}`}
                onOpenSources={() => setSelected('reserves')} data-testid="indicator-reserves"
              />
              <Indicator
                label={pieces.label} numerator={pieces.numerator} denominator={pieces.denominator} unit={pieces.unit}
                note={pieces.note} onOpenSources={() => setSelected('pieces')} data-testid="indicator-pieces"
              />
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: semanticColors.neutral.textMuted }}>
              {`Calculé le ${formatServerDateTime(state.data.computed_at)}. Instance active seulement : les archives sont exclues.`}
            </p>
          </>
        );
      })()}
      {selected && <Sources key={selected} sourceKey={selected} onNavigate={onNavigate} />}
    </section>
  );
}
