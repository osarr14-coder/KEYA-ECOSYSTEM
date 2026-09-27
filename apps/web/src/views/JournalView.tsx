import { ApiErrorBanner, PageHeader, semanticColors, formatServerDateTime} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { useApiResource } from '../api/useApiResource';

/**
 * Audit UI R1 (R02, CDC R1 §4) — journal des actes métier, en LECTURE SEULE
 * pour l'administrateur de la démonstration : aucune action proposée, le
 * serveur n'expose d'ailleurs aucune écriture.
 */
// Audit UI R1 (F06) : format de date unique, fuseau indiqué.
function formatDate(value: string) {
  return formatServerDateTime(value);
}

export function JournalView() {
  const api = useApiClient();
  const journal = useApiResource(() => api.getAdminJournal(), []);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <PageHeader
        title="Journal"
        subtitle="Actes enregistrés par la plateforme, du plus récent au plus ancien. Lecture seule : aucune modification ni suppression possible."
      />
      {journal.status === 'loading' && <p>Chargement du journal…</p>}
      {journal.status === 'error' && <ApiErrorBanner error={journal.error} title="Impossible de charger le journal." />}
      {journal.status === 'success' && journal.data.length === 0 && <p>Aucun acte enregistré pour le moment.</p>}
      {journal.status === 'success' && journal.data.length > 0 && (
        <table data-testid="journal-table">
          <thead>
            <tr>
              <th>Date (GMT, Abidjan)</th>
              <th>Action</th>
              <th>Objet</th>
              <th>Auteur</th>
              <th>Organisation</th>
            </tr>
          </thead>
          <tbody>
            {journal.data.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.created_at)}</td>
                <td>
                  {entry.action}
                  {entry.justification && (
                    <span style={{ display: 'block', fontSize: '13px', color: semanticColors.neutral.textMuted }}>
                      {entry.justification}
                    </span>
                  )}
                </td>
                <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' }}>
                  {`${entry.object_type} · ${entry.object_id.slice(0, 8)}`}
                </td>
                <td>{entry.actor ?? 'Système'}</td>
                <td>{entry.organization}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
