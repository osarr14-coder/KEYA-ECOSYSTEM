import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Card, Input, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type {
  AccountBalance, AccountMilestone, Disbursement, ProgramAccountSummary,
} from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { SIMULATION_NOTICE, formatAmount, today } from './FinancialFilePanel';

/**
 * Ticket F-068 — comptes simulés des programmes et décaissements vers le
 * constructeur (backend B-052, CDC V3 §8.2/§8.3). Lecture équipe KEYIMMO ;
 * actions Finance seulement (`canAct`). Le serveur décide tout : éligibilité
 * (jalon accepté, aucune réserve ouverte, pièces, disponible), retour en
 * brouillon si l'acceptation devient caduque, refus motivés (409 affichés
 * tels quels). Aucun montant n'est recalculé ici.
 */

export const NO_CONFIRMATION_REASON = 'Confirmation bénéficiaire non reçue';

const blockStyle = {
  border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '8px', padding: '12px', marginTop: '8px',
} as const;

function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>, fallback: string) {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, fallback));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}

function BalanceBlock({ balance }: { balance: AccountBalance }) {
  const rows: [string, string][] = [
    ['Encaissements rapprochés', balance.received],
    ['Sorties exécutées', balance.executed],
    ['Réservé (demandes éligibles)', balance.reserved],
    ['Disponible', balance.available],
  ];
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd style={{ margin: 0 }} data-testid={`balance-${label}`}>{formatAmount(value, balance.currency)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PrepareForm({
  milestone, organizationId, onPrepared,
}: { milestone: AccountMilestone; organizationId: string; onPrepared: () => void }) {
  const api = useApiClient();
  const [amount, setAmount] = useState('');
  const { pending, error, run } = useAction();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () => api.prepareDisbursement(organizationId, milestone.id, amount.trim()),
      'Échec de la préparation.',
    );
    if (ok) {
      setAmount('');
      onPrepared();
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label={`Préparer un décaissement — ${milestone.lot.name} ${milestone.label}`}
      style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap' }}
    >
      <Input
        aria-label={`Montant à décaisser — ${milestone.lot.name} ${milestone.label}`}
        inputMode="numeric"
        placeholder="Montant (XOF)"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        style={{ width: '150px' }}
      />
      <Button type="submit" variant="secondary" disabled={pending || amount.trim() === ''}>Préparer</Button>
      {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function MilestonesTable({
  milestones: allMilestones, organizationId, canAct, onChanged,
}: { milestones: AccountMilestone[]; organizationId: string; canAct: boolean; onChanged: () => void }) {
  // Par défaut, seuls les jalons actionnables (décaissables ou avec une
  // demande en cours) : un programme compte vite des dizaines de jalons.
  const [showAll, setShowAll] = useState(false);
  const actionable = allMilestones.filter((milestone) => milestone.disbursable || milestone.open_disbursement);
  const milestones = showAll ? allMilestones : actionable;
  return (
    <>
      <label style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: '0 0 8px' }}>
        <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
        {`Afficher tous les jalons (${allMilestones.length})`}
      </label>
      {milestones.length === 0 && (
        <p style={{ margin: 0 }}>Aucun jalon décaissable pour l&apos;instant (acceptation technique requise).</p>
      )}
      {milestones.length > 0 && (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Lot</th>
          <th style={{ textAlign: 'left' }}>Jalon</th>
          <th style={{ textAlign: 'left' }}>Prestataire affecté</th>
          <th style={{ textAlign: 'left' }}>Conditions techniques</th>
          {canAct && <th style={{ textAlign: 'left' }}>Décaissement</th>}
        </tr>
      </thead>
      <tbody>
        {milestones.map((milestone) => (
          <tr key={milestone.id} style={{ verticalAlign: 'top' }}>
            <td>{milestone.lot.name}</td>
            <td>{milestone.label}</td>
            <td>{milestone.beneficiary_organization.name}</td>
            <td data-testid={`milestone-conditions-${milestone.code}`}>
              {milestone.disbursable ? 'Réunies (jalon accepté, aucune réserve, pièces présentes)' : milestone.blockers.join(' ; ')}
            </td>
            {canAct && (
              <td>
                {milestone.open_disbursement
                  ? 'Demande en cours (ci-dessous)'
                  : <PrepareForm milestone={milestone} organizationId={organizationId} onPrepared={onChanged} />}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
      )}
    </>
  );
}

function DisbursementBlock({
  disbursement, organizationId, canAct, onChanged,
}: { disbursement: Disbursement; organizationId: string; canAct: boolean; onChanged: () => void }) {
  const api = useApiClient();
  const { pending, error, run } = useAction();
  const [reference, setReference] = useState('');
  const [executedOn, setExecutedOn] = useState(today());
  const [cancelReason, setCancelReason] = useState('');
  const act = (action: () => Promise<unknown>, fallback: string) => {
    void run(action, fallback).then((ok) => { if (ok) onChanged(); });
  };
  const isOpen = disbursement.status === 'draft' || disbursement.status === 'eligible';
  const awaitingReconciliation = disbursement.status === 'executed_sim' && disbursement.flow_status !== 'reconciled_sim';

  return (
    <article
      aria-label={`Décaissement ${disbursement.lot.name} — ${disbursement.milestone.label}`}
      style={blockStyle}
    >
      <p style={{ margin: 0 }}>
        <strong>{`${disbursement.lot.name} — ${disbursement.milestone.label}`}</strong>
        {` · ${formatAmount(disbursement.amount, disbursement.currency)} vers ${disbursement.beneficiary_organization.name}`}
      </p>
      <p style={{ margin: '4px 0 0' }}>
        {'Demande : '}
        <span data-testid="disbursement-status">{disbursement.status_label}</span>
        {' · Preuve : '}
        <span data-testid="disbursement-flow">{disbursement.flow_status_label}</span>
        {disbursement.bank_reference && ` · référence ${disbursement.bank_reference} du ${disbursement.executed_on}`}
      </p>
      {disbursement.beneficiary_confirmation && (
        <p style={{ margin: '4px 0 0' }} data-testid="disbursement-confirmation">
          {disbursement.beneficiary_confirmation === 'confirmed'
            ? 'Réception confirmée par le bénéficiaire (simulé)'
            : 'Confirmation du bénéficiaire : absente'}
        </p>
      )}
      {disbursement.reconciliation_reason && (
        <p style={{ margin: '4px 0 0' }}>{`Rapproché avec le motif « ${disbursement.reconciliation_reason} »`}</p>
      )}
      {disbursement.cancel_reason && <p style={{ margin: '4px 0 0' }}>{`Annulé : ${disbursement.cancel_reason}`}</p>}

      {canAct && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '8px' }}>
          {disbursement.status === 'draft' && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => act(
                () => api.checkDisbursementEligibility(disbursement.id, organizationId),
                'Contrôle refusé.',
              )}
            >
              Contrôler l&apos;éligibilité
            </Button>
          )}
          {disbursement.status === 'eligible' && (
            <form
              aria-label={`Exécuter le décaissement ${disbursement.lot.name} — ${disbursement.milestone.label}`}
              onSubmit={(event) => {
                event.preventDefault();
                act(
                  () => api.executeDisbursement(disbursement.id, organizationId, {
                    bank_reference: reference.trim(), executed_on: executedOn,
                  }),
                  'Exécution refusée.',
                );
              }}
              style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}
            >
              <label>
                Référence bancaire simulée
                <Input aria-label="Référence de sortie" value={reference} onChange={(event) => setReference(event.target.value)} required style={{ marginTop: '4px', width: '180px' }} />
              </label>
              <label>
                Exécuté le
                <Input aria-label="Date d'exécution" type="date" value={executedOn} onChange={(event) => setExecutedOn(event.target.value)} required style={{ marginTop: '4px' }} />
              </label>
              <Button type="submit" disabled={pending || reference.trim() === ''}>Exécuter (simulé)</Button>
            </form>
          )}
          {isOpen && (
            <form
              aria-label={`Annuler le décaissement ${disbursement.lot.name} — ${disbursement.milestone.label}`}
              onSubmit={(event) => {
                event.preventDefault();
                act(() => api.cancelDisbursement(disbursement.id, organizationId, cancelReason.trim()), "Échec de l'annulation.");
              }}
              style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}
            >
              <label>
                Motif
                <Input aria-label="Motif d'annulation du décaissement" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} style={{ marginTop: '4px', width: '200px' }} />
              </label>
              <Button type="submit" variant="secondary" disabled={pending || cancelReason.trim() === ''}>Annuler la demande</Button>
            </form>
          )}
          {awaitingReconciliation && disbursement.flow_status === 'beneficiary_confirmed_sim' && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => act(() => api.reconcileDisbursement(disbursement.id, organizationId), 'Rapprochement refusé.')}
            >
              Rapprocher
            </Button>
          )}
          {awaitingReconciliation && disbursement.flow_status === 'bank_executed_sim' && (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => act(
                () => api.reconcileDisbursement(disbursement.id, organizationId, NO_CONFIRMATION_REASON),
                'Rapprochement refusé.',
              )}
            >
              {`Rapprocher sans confirmation (motif : « ${NO_CONFIRMATION_REASON} »)`}
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </article>
  );
}

function ProgramAccountPanel({ summary, canAct }: { summary: ProgramAccountSummary; canAct: boolean }) {
  const api = useApiClient();
  const organizationId = summary.organization.id;
  const state = useApiResource(
    () => api.getProgramAccount(summary.program.id, organizationId),
    [summary.program.id, organizationId],
  );

  if (state.status === 'loading') return <p>Chargement du compte…</p>;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger le compte." onRetry={state.refetch} />;
  }
  const account = state.data;

  return (
    <Card title={`Compte — ${account.program.name}`} icon="wallet">
      <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em' }}>{SIMULATION_NOTICE}</p>
      <BalanceBlock balance={account.balance} />
      <h4 style={{ margin: '16px 0 4px' }}>Jalons</h4>
      <MilestonesTable
        milestones={account.milestones}
        organizationId={organizationId}
        canAct={canAct}
        onChanged={state.refetch}
      />
      <h4 style={{ margin: '16px 0 4px' }}>Décaissements</h4>
      {account.disbursements.length === 0 && <p style={{ margin: 0 }}>Aucun décaissement.</p>}
      {account.disbursements.map((disbursement) => (
        <DisbursementBlock
          key={`${disbursement.id}-${disbursement.status}-${disbursement.flow_status}`}
          disbursement={disbursement}
          organizationId={organizationId}
          canAct={canAct}
          onChanged={state.refetch}
        />
      ))}
    </Card>
  );
}

export function FinanceAccountsView({ canAct }: { canAct: boolean }) {
  const api = useApiClient();
  const state = useApiResource(() => api.listProgramAccounts(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (state.status === 'loading') return <p>Chargement…</p>;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger les comptes." onRetry={state.refetch} />;
  }
  const selected = state.data.find((account) => account.program.id === selectedId) ?? state.data[0];

  return (
    <section aria-label="Comptes et décaissements">
      <h2>Comptes des programmes et décaissements</h2>
      {state.data.length === 0 && <p>Aucun programme avec une réservation ou un décaissement.</p>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {state.data.map((account) => (
          <Button
            key={account.program.id}
            type="button"
            variant={account.program.id === selected?.program.id ? 'primary' : 'secondary'}
            onClick={() => setSelectedId(account.program.id)}
          >
            {`${account.program.name} — disponible ${formatAmount(account.balance.available, account.balance.currency)}`}
          </Button>
        ))}
      </div>
      {selected && <ProgramAccountPanel key={selected.program.id} summary={selected} canAct={canAct} />}
    </section>
  );
}
