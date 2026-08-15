import { StatusBadge } from '@keya/design-system';

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
    return <p role="alert">Impossible de charger l'avancement.</p>;
  }
  if (state.data.length === 0) {
    return <p>Aucune preuve pour le moment.</p>;
  }

  return (
    <section aria-label="Avancement et preuves">
      {/* L'ordre d'affichage est EXACTEMENT celui reçu de l'API — le backend
          trie déjà (created_at décroissant), aucun tri ni recalcul ici. */}
      <ol style={{ listStyle: 'none', padding: 0 }}>
        {state.data.map((item) => (
          <li key={item.id} style={{ marginBottom: '16px' }}>
            <div>
              <strong>{item.milestone_label}</strong>
              {item.status && (
                <StatusBadge level={item.status.level} event={toTrustEventData(item.status)} />
              )}
            </div>
            <p>
              Ajouté par {item.added_by} — {new Date(item.created_at).toLocaleString('fr-FR')}
            </p>
            <ul>
              {item.documents.map((document, index) => (
                <li key={index}>
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
