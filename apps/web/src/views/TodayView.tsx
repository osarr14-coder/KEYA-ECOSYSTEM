import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Card, KeyFigure, PageHeader, Pill, type PillTone, formatServerDateTime, semanticColors, formatCalendarDate,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { AdminReservation, Task } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-075 (direction « Confiance premium ») — « À faire », écran
 * d'arrivée de toute l'équipe KEYIMMO : la file ACTIONNABLE d'abord (tâches
 * de la boîte personnelle transverse, B-044/B-056), chacune avec un accès
 * direct à l'écran où la traiter ; puis les chiffres qui appellent une
 * action et le pipeline des ventes. Remplace l'ancien écran « Tâches »
 * (F-061/F-062/F-063) dont il reprend le marquage « traité ».
 */

export type NavigationTarget = { tab: string; reservationId?: string };

/** Écran où traiter une tâche, d'après sa source (préfixe : `notify_user`
 * suffixe la source par l'id du destinataire) et son sujet. */
export function taskTarget(task: Task): NavigationTarget | null {
  const source = task.source.split(':')[0];
  if (task.subject_type === 'sales.reservation') return { tab: 'reservations', reservationId: task.subject_id };
  if (source.startsWith('reservation_') || source === 'payment_received') return { tab: 'reservations' };
  if (source.startsWith('payment_notice')) return { tab: 'payment-notices' };
  if (source.startsWith('devis') || source.startsWith('lot_ledger')) return { tab: 'devis' };
  if (source.startsWith('program_request')) return { tab: 'program-requests' };
  if (source === 'mission_assigned' || source === 'reserve_opened') return { tab: 'controls' };
  // PO-2026-09-28-44 (lot 2) : affectation du contrôle (gestionnaire), jalon
  // décaissable (Finance).
  if (source === 'control_to_assign') return { tab: 'controls' };
  if (source === 'milestone_disbursable') return { tab: 'finance' };
  return null;
}

const TYPE_LABELS: Record<Task['type'], { label: string; tone: PillTone }> = {
  task: { label: 'À traiter', tone: 'alert' },
  notification: { label: 'Information', tone: 'info' },
  // PO-2026-09-28-17 : le rouge est réservé aux erreurs et aux refus ; une
  // alerte attend une action (Attention), une exception signale une erreur.
  alert: { label: 'Alerte', tone: 'alert' },
  exception: { label: 'Exception', tone: 'danger' },
};


// PO-2026-09-28-11 : format unique F06, précédé du jour de la semaine.
function todayLabel() {
  const now = new Date();
  const weekday = now.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Africa/Abidjan' });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${formatCalendarDate(now.toISOString())}`;
}

function TaskCard({
  task, onCompleted, onOpen,
}: { task: Task; onCompleted: () => void; onOpen?: () => void }) {
  const api = useApiClient();
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = TYPE_LABELS[task.type];

  async function handleComplete() {
    setCompleting(true);
    setError(null);
    try {
      await api.completeMyInboxTask(task.id, task.organization);
      onCompleted();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.detail : undefined;
      setError(detail ?? 'Échec du marquage comme traité.');
      setCompleting(false);
    }
  }

  return (
    <li
      data-type={task.type}
      data-testid="todo-task"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: '16px',
        padding: '16px 20px',
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '6px',
        background: semanticColors.neutral.surface,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill tone={meta.tone}>{meta.label}</Pill>
          {task.priority === 'high' && <Pill tone="alert">Prioritaire</Pill>}
          <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>{formatServerDateTime(task.created_at)}</span>
        </div>
        <strong style={{ fontSize: '16px' }}>{task.label}</strong>
        {error && <AlertBanner title={error} />}
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {onOpen && (
          <Button type="button" onClick={onOpen}>
            Ouvrir
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={() => { void handleComplete(); }} disabled={completing} style={{ whiteSpace: 'nowrap' }}>
          {completing ? 'Marquage…' : 'Marquer comme traité'}
        </Button>
      </div>
    </li>
  );
}

function SalesPipeline({ reservations }: { reservations: AdminReservation[] }) {
  const columns = [
    { label: 'Biens bloqués', count: reservations.filter((r) => r.status === 'held').length },
    { label: 'Réservées', count: reservations.filter((r) => r.status === 'reserved').length },
    { label: 'Concrétisées', count: reservations.filter((r) => r.status === 'committed').length },
    { label: 'Expirées / annulées', count: reservations.filter((r) => r.status === 'expired' || r.status === 'cancelled').length },
  ];
  const max = Math.max(1, ...columns.map((column) => column.count));
  return (
    <Card title="Pipeline des ventes" icon="building" aria-label="Pipeline des ventes">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
        {columns.map((column) => (
          <div key={column.label} data-testid="pipeline-column" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontWeight: 600, color: semanticColors.neutral.textMuted }}>{column.label}</span>
            <span aria-hidden="true" style={{ height: '8px', borderRadius: '4px', background: semanticColors.progress.track, overflow: 'hidden' }}>
              <span
                style={{
                  display: 'block', height: '100%', width: `${(column.count / max) * 100}%`, background: semanticColors.neutral.heading,
                }}
              />
            </span>
            <span style={{ fontSize: '22px', fontWeight: column.count ? 700 : 500, fontVariantNumeric: 'tabular-nums', color: column.count ? semanticColors.neutral.heading : semanticColors.neutral.textMuted }}>
              {column.count}
              <span style={{ fontSize: '14px', fontWeight: 500, color: semanticColors.neutral.textMuted }}>
                {column.count > 1 ? ' dossiers' : ' dossier'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TodayView({
  onNavigate, availableTabs, showSales, showPaymentNotices,
}: {
  onNavigate: (target: NavigationTarget) => void;
  /** Onglets visibles pour l'utilisateur : « Ouvrir » n'apparaît que vers un écran accessible. */
  availableTabs: string[];
  showSales: boolean;
  showPaymentNotices: boolean;
}) {
  const api = useApiClient();
  const tasksState = useApiResource(() => api.getMyInboxTasks({ status: 'pending' }), []);
  // Chiffres de contexte : un échec n'empêche jamais de traiter la file.
  const reservationsState = useApiResource(
    () => (showSales ? api.listReservations() : Promise.resolve([] as AdminReservation[])),
    [showSales],
  );
  const noticesState = useApiResource(
    () => (showPaymentNotices ? api.listPaymentNotices('declared') : Promise.resolve([])),
    [showPaymentNotices],
  );

  const reservations = reservationsState.status === 'success' ? reservationsState.data : null;
  const toValidate = reservations?.filter((r) => r.status === 'held' && !r.validated_at).length;
  const activeFiles = reservations?.filter((r) => r.status === 'held' || r.status === 'reserved').length;
  const notices = noticesState.status === 'success' ? noticesState.data.length : undefined;
  const pending = tasksState.status === 'success' ? tasksState.data.length : undefined;
  const display = (value: number | undefined) => (value === undefined ? '—' : value);

  function openIfAvailable(target: NavigationTarget | null) {
    // Audit UI R1 (R03) : Finance ouvre un dossier dans sa vue en lecture
    // seule « Appels par dossier », jamais dans « Dossiers clients ».
    const resolved = target && target.tab === 'reservations' && !availableTabs.includes('reservations')
      ? { ...target, tab: 'receipts' } : target;
    return resolved && availableTabs.includes(resolved.tab) ? () => onNavigate(resolved) : undefined;
  }

  return (
    <section aria-label="À faire" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow={todayLabel()}
        title="Vos priorités du jour"
        subtitle={pending === undefined ? undefined : pending === 0
          ? 'Rien en attente : tout est à jour.'
          : `${pending} action${pending > 1 ? 's' : ''} en attente dans votre boîte.`}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <KeyFigure label="Actions en attente" value={display(pending)} tone={pending ? 'accent' : 'neutral'} data-testid="kf-pending" />
        {showSales && (
          <KeyFigure
            label="Dossiers à examiner"
            value={display(toValidate)}
            tone={toValidate ? 'accent' : 'neutral'}
            onClick={availableTabs.includes('reservations') ? () => onNavigate({ tab: 'reservations' }) : undefined}
            data-testid="kf-to-validate"
          />
        )}
        {showPaymentNotices && (
          <KeyFigure
            label="Virements signalés à traiter"
            value={display(notices)}
            tone={notices ? 'accent' : 'neutral'}
            onClick={() => onNavigate({ tab: 'payment-notices' })}
            data-testid="kf-notices"
          />
        )}
        {showSales && <KeyFigure label="Dossiers actifs" value={display(activeFiles)} hint="bloqués ou réservés" data-testid="kf-active" />}
      </div>

      <section aria-label="Tâches" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 style={{ margin: 0 }}>À faire</h2>
        {tasksState.status === 'loading' && <p>Chargement…</p>}
        {tasksState.status === 'error' && (
          <ApiErrorBanner error={tasksState.error} title="Impossible de charger vos tâches." onRetry={tasksState.refetch} />
        )}
        {tasksState.status === 'success' && tasksState.data.length === 0 && (
          <Card>
            <p data-testid="no-tasks" style={{ margin: 0 }}>Aucune tâche en attente pour le moment.</p>
          </Card>
        )}
        {tasksState.status === 'success' && tasksState.data.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {tasksState.data.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onCompleted={() => tasksState.refetch()}
                onOpen={openIfAvailable(taskTarget(task))}
              />
            ))}
          </ul>
        )}
      </section>

      {showSales && reservations && <SalesPipeline reservations={reservations} />}
    </section>
  );
}
