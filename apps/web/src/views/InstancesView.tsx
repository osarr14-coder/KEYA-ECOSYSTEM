import { type FormEvent, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Card, Input, PageHeader, Pill, formatCalendarDate, formatServerDateTime, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { setViewedArchive, useViewedArchive } from '../api/archiveView';
import { formatDrfFieldErrors } from '../api/errors';
import type { InstanceRow } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Lot 5 — instances de démonstration (CDC §9.2 étape 11, T14).
 * - PO-2026-09-29-03 : l'administrateur archive l'instance active et en crée
 *   une nouvelle depuis le jeu versionné, après avoir saisi son code.
 * - PO-2026-09-29-01 (A6) : l'administrateur et le gestionnaire consultent
 *   une archive en lecture seule.
 * - PO-2026-09-29-04 : conservation jusqu'à la fin de campagne + 90 jours.
 */

function ArchiveForm({ active, onDone }: { active: InstanceRow; onDone: (message: string) => void }) {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api.archiveInstance(code);
      onDone(`Instance ${result.archived.code} archivée ; nouvelle instance ${result.created?.code ?? ''} créée depuis le jeu ${result.created?.dataset_version ?? ''}.`);
      setOpen(false);
      setCode('');
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, 'Archivage impossible.'));
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="accent" onClick={() => setOpen(true)}>
        Archiver et créer une nouvelle instance
      </Button>
    );
  }
  return (
    <form
      role="alertdialog"
      aria-label="Archiver l’instance active"
      onSubmit={(event) => { void submit(event); }}
      style={{
        display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', borderRadius: '6px',
        border: `1px solid ${semanticColors.neutral.heading}`, background: semanticColors.neutral.surface,
      }}
    >
      <strong>{`Archiver l’instance ${active.code} ?`}</strong>
      <p style={{ margin: 0 }}>
        L’instance reste en base, consultable en lecture seule par l’administrateur et le gestionnaire ; plus aucune
        modification n’y sera possible. Une nouvelle instance est créée depuis le jeu versionné : programme et lots
        vierges, mêmes comptes de démonstration. L’opération est inscrite au journal.
      </p>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span>Pour confirmer, saisissez le code de l’instance</span>
        <Input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      {error && <AlertBanner title={error} />}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Button type="submit" variant="accent" disabled={pending || code.trim() !== active.code}>
          {pending ? 'Archivage…' : 'Archiver et créer la nouvelle instance'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => { setOpen(false); setCode(''); setError(null); }}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function InstancesView({ canArchive, onConsult }: { canArchive: boolean; onConsult: () => void }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getInstances(), []);
  const viewed = useViewedArchive();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section aria-label="Instances et archives" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Instances et archives"
        subtitle="Une seule instance active à la fois. Une archive reste consultable en lecture seule par l’administrateur et le gestionnaire ; elle n’apparaît jamais dans les indicateurs de l’instance active."
      />
      {notice && <p role="status" style={{ margin: 0, fontWeight: 600 }}>{notice}</p>}
      {state.status === 'loading' && <p>Chargement des instances…</p>}
      {state.status === 'error' && <ApiErrorBanner error={state.error} title="Impossible de charger les instances." />}
      {state.status === 'success' && (() => {
        const active = state.data.instances.find((row) => row.status === 'ACTIVE');
        return (
          <>
            <Card title="Instance active" icon="history">
              {active ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <p style={{ margin: 0 }} data-testid="active-instance">
                    {`${active.code} — jeu ${active.dataset_version}, créée le ${formatServerDateTime(active.created_at)}`}
                    {active.origin ? `, à la suite de ${active.origin}` : ''}
                  </p>
                  {canArchive && !viewed && <ArchiveForm active={active} onDone={setNotice} />}
                </div>
              ) : <p style={{ margin: 0 }}>Aucune instance active.</p>}
            </Card>
            <Card title="Conservation des archives" icon="scale">
              <p style={{ margin: 0 }} data-testid="retention">
                {state.data.campaign_end
                  ? `Fin de campagne : ${formatCalendarDate(state.data.campaign_end)}. Chaque archive est conservée ${state.data.retention_days} jours de plus, puis sa suppression est faite par l’exploitation, tracée au journal.`
                  : `Fin de campagne non fixée : les archives sont conservées. Elles le seront ${state.data.retention_days} jours après la fin de la campagne.`}
              </p>
            </Card>
            <Card title="Archives" icon="folder">
              {state.data.instances.filter((row) => row.status === 'ARCHIVED').length === 0 ? (
                <p style={{ margin: 0 }}>Aucune archive.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Instance</th>
                        <th>Jeu</th>
                        <th>Créée le</th>
                        <th>Archivée le</th>
                        <th>Conservée jusqu’au</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.instances.filter((row) => row.status === 'ARCHIVED').map((row) => (
                        <tr key={row.code} data-testid="archive-row">
                          <td>{row.code}</td>
                          <td>{row.dataset_version}</td>
                          <td>{formatServerDateTime(row.created_at)}</td>
                          <td>{row.archived_at ? formatServerDateTime(row.archived_at) : '—'}</td>
                          <td>
                            {row.retention_until ? formatCalendarDate(row.retention_until) : 'Fin de campagne non fixée'}
                            {row.retention_expired && <Pill tone="alert">Échue</Pill>}
                          </td>
                          <td>
                            {viewed?.code === row.code ? (
                              <Pill tone="info">Consultée</Pill>
                            ) : (
                              <Button
                                type="button"
                                variant="secondary"
                                aria-label={`Consulter l’archive ${row.code}`}
                                onClick={() => { setViewedArchive({ code: row.code, archived_at: row.archived_at }); onConsult(); }}
                              >
                                Consulter
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        );
      })()}
    </section>
  );
}
