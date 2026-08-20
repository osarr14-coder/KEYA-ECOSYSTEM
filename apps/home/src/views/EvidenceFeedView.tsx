import { ApiErrorBanner, StatusBadge, semanticColors } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { toTrustEventData } from '../api/types';
import { useApiResource } from '../api/useApiResource';

export interface EvidenceFeedViewProps {
  lotId: string;
}

export function EvidenceFeedView({ lotId }: EvidenceFeedViewProps) {
  const api = useApiClient();
  const state = useApiResource(() => api.getLotEvidenceFeed(lotId), [lotId]);

  if (state.status === 'loading') {
    return <p>Chargement…</p>;
  }
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger l'avancement." onRetry={state.refetch} />;
  }
  if (state.data.length === 0) {
    return <p>Aucune preuve pour le moment.</p>;
  }

  return (
    <section aria-label="Avancement et preuves">
      {/* L'ordre d'affichage est EXACTEMENT celui reçu de l'API — le backend
          trie déjà (created_at décroissant), aucun tri ni recalcul ici. */}
      <ol style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {state.data.map((item) => (
          <li
            key={item.id}
            style={{ padding: '12px', border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '8px' }}
          >
            <div>
              <strong>{item.milestone_label}</strong>
              {item.status && (
                <StatusBadge level={item.status.level} event={toTrustEventData(item.status)} />
              )}
            </div>
            <p style={{ color: semanticColors.neutral.textMuted }}>
              Ajouté par {item.added_by} — {new Date(item.created_at).toLocaleString('fr-FR')}
            </p>
            {/* Ticket 023 (polish visuel) — cette liste imbriquée n'avait
                jamais de reset (`listStyle`/`padding`), contrairement à
                TOUTES les autres listes de ce projet : puces + retrait par
                défaut du navigateur apparaissaient ici et nulle part
                ailleurs, seule incohérence de ce genre trouvée dans
                l'inventaire. */}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {item.documents.map((document, index) => (
                <li key={index} style={{ color: semanticColors.neutral.textMuted, fontSize: '13px' }}>
                  {document.category} — {document.source}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
