import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, Card, DateInput, Input, KeyFigure, PageHeader, Pill, type PillTone, semanticColors, SimulatedMark, formatCalendarDate,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type {
  AccountMilestone, Disbursement, ProgramAccount, ProgramAccountSummary,
} from '../api/types';
import { useApiResource } from '../api/useApiResource';
import { formatAmount, today } from './FinancialFilePanel';

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
  border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '6px', padding: '16px 18px', marginTop: '10px',
  display: 'flex', flexDirection: 'column', gap: '8px',
} as const;

// Ticket F-078 (direction « Confiance premium ») — états en pastilles.
const DISBURSEMENT_TONE: Record<Disbursement['status'], PillTone> = {
  draft: 'neutral',
  eligible: 'alert',
  executed_sim: 'info',
  cancelled: 'danger',
};

const labelStyle = {
  display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 600,
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

type BalancePart = 'received' | 'executed' | 'reserved' | 'available';

/**
 * Audit UI R1 (F03, CDC §1 et §9.3) — chaque montant du solde se décompose
 * jusqu'à ses mouvements : un clic ouvre la liste des encaissements ou des
 * décaissements qui le forment ; « Disponible » montre son calcul.
 */
function BalanceBlock({ account }: { account: ProgramAccount }) {
  const { balance } = account;
  const [open, setOpen] = useState<BalancePart | null>(null);
  const rows: [BalancePart, string, string, 'neutral' | 'accent' | 'success'][] = [
    ['received', 'Encaissements rapprochés', balance.received, 'neutral'],
    ['executed', 'Sorties exécutées', balance.executed, 'neutral'],
    ['reserved', 'Réservé (demandes éligibles)', balance.reserved, 'accent'],
    ['available', 'Disponible', balance.available, 'success'],
  ];
  const receipts = account.receipts ?? [];
  const executed = account.disbursements.filter((disbursement) => disbursement.status === 'executed_sim');
  const reserved = account.disbursements.filter((disbursement) => disbursement.status === 'eligible');
  const movement = (key: string, label: string, detail: string, amount: string) => (
    <li key={key} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${semanticColors.neutral.border}` }}>
      <span style={{ flex: '1 1 260px' }}>
        <strong>{label}</strong>
        <span style={{ display: 'block', fontSize: '13px', color: semanticColors.neutral.textMuted }}>{detail}</span>
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmount(amount, balance.currency)}</span>
    </li>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
        {rows.map(([part, label, value, tone]) => (
          <KeyFigure
            key={part}
            label={label}
            value={formatAmount(value, balance.currency)}
            tone={tone}
            hint={open === part ? 'Masquer le détail' : 'Voir le détail'}
            onClick={() => setOpen(open === part ? null : part)}
            data-testid={`balance-${label}`}
          />
        ))}
      </div>
      {open && (
        <section aria-label="Détail du montant" data-testid="balance-detail" style={{ border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '6px', padding: '12px 16px' }}>
          {open === 'received' && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {receipts.length === 0 && <li>Aucun encaissement rapproché.</li>}
              {receipts.map((receipt) => movement(
                receipt.id, receipt.bank_reference,
                `${receipt.client} · ${receipt.lot} · reçu le ${formatCalendarDate(receipt.received_on)} · ${receipt.status_label}`,
                receipt.amount,
              ))}
            </ul>
          )}
          {(open === 'executed' || open === 'reserved') && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {(open === 'executed' ? executed : reserved).length === 0 && <li>Aucun décaissement dans cet état.</li>}
              {(open === 'executed' ? executed : reserved).map((disbursement) => movement(
                disbursement.id, `${disbursement.lot.name} — ${disbursement.milestone.label}`,
                [disbursement.beneficiary_organization.name, disbursement.status_label, disbursement.flow_status_label,
                  disbursement.bank_reference].filter(Boolean).join(' · '),
                disbursement.amount,
              ))}
            </ul>
          )}
          {open === 'available' && (
            <p style={{ margin: 0 }} data-testid="balance-formula">
              {`Disponible = encaissements rapprochés ${formatAmount(balance.received, balance.currency)} − sorties exécutées `
                + `${formatAmount(balance.executed, balance.currency)} − réservé ${formatAmount(balance.reserved, balance.currency)} `
                + `= ${formatAmount(balance.available, balance.currency)}`}
            </p>
          )}
        </section>
      )}
    </div>
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
              {milestone.disbursable ? (
                <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                  <Pill tone="success">Réunies</Pill>
                  <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>
                    (jalon accepté, aucune réserve, pièces présentes)
                  </span>
                </span>
              ) : (
                <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                  <Pill tone="neutral">Bloqué</Pill>
                  <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>{milestone.blockers.join(' ; ')}</span>
                </span>
              )}
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
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {'Demande : '}
        <Pill tone={DISBURSEMENT_TONE[disbursement.status]} data-testid="disbursement-status">{disbursement.status_label}</Pill>
        {' · Preuve : '}
        <Pill tone={disbursement.flow_status === 'reconciled_sim' ? 'success' : 'neutral'} data-testid="disbursement-flow">
          {disbursement.flow_status_label}
        </Pill>
        {disbursement.bank_reference && (
          <span style={{ color: semanticColors.neutral.textMuted }}>{` · référence ${disbursement.bank_reference} du ${disbursement.executed_on}`}</span>
        )}
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
              <label style={labelStyle}>
                Référence bancaire simulée
                <Input aria-label="Référence de sortie" value={reference} onChange={(event) => setReference(event.target.value)} required style={{ width: '200px' }} />
              </label>
              {/* PO-2026-09-28-11 : saisie au format F06 (jour · mois · année). */}
              <div style={labelStyle}>
                <span>Exécuté le</span>
                <DateInput label="Date d'exécution" value={executedOn} onChange={setExecutedOn} />
              </div>
              <Button type="submit" variant="accent" disabled={pending || reference.trim() === ''}>Exécuter (simulé)</Button>
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
              <label style={labelStyle}>
                Motif
                <Input aria-label="Motif d'annulation du décaissement" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} style={{ width: '220px' }} />
              </label>
              <Button type="submit" variant="secondary" disabled={pending || cancelReason.trim() === ''}>Annuler la demande</Button>
            </form>
          )}
          {awaitingReconciliation && disbursement.flow_status === 'beneficiary_confirmed_sim' && (
            <Button
              type="button"
              variant="accent"
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
      <SimulatedMark detail="Compte du programme et décaissements" style={{ margin: '0 0 14px' }} />
      <BalanceBlock account={account} />
      <h4 style={{ margin: '24px 0 8px' }}>Jalons</h4>
      <MilestonesTable
        milestones={account.milestones}
        organizationId={organizationId}
        canAct={canAct}
        onChanged={state.refetch}
      />
      <h4 style={{ margin: '24px 0 4px' }}>Décaissements</h4>
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
      <PageHeader
        title="Comptes & décaissements"
        subtitle="Solde simulé de chaque programme, jalons décaissables après acceptation technique, et suivi des sorties jusqu’au rapprochement."
      />
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
