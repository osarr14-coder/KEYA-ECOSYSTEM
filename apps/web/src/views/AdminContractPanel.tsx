import { type FormEvent, useState } from 'react';

import {
  ApiErrorBanner, Button, semanticColors,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { AdminReservation, ContractAction, ContractVersion } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-067 (partie 2) — contrat fictif versionné côté équipe KEYIMMO
 * (backend B-049, CDC V3 §6.2) : le gestionnaire prépare, soumet et
 * approuve ; le client signe (HOME). Aucune transition n'est décidée ici :
 * les boutons reflètent l'état, le serveur tranche (409 affiché tel quel).
 * Une version soumise, approuvée ou signée est figée : une correction
 * passe par une nouvelle version, pré-remplie avec la précédente.
 */

const SIMULATION_NOTICE = 'SIMULÉ — SANS VALEUR OPÉRATIONNELLE · DÉMONSTRATION — DONNÉES FICTIVES';

const ACTIVE_RESERVATION_STATUSES: AdminReservation['status'][] = ['held', 'reserved', 'committed'];

const textareaStyle = {
  width: '100%',
  minHeight: '120px',
  padding: '8px 12px',
  borderRadius: '8px',
  border: `1px solid ${semanticColors.neutral.border}`,
  font: 'inherit',
  marginTop: '4px',
} as const;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Abidjan' });
}

function ContentForm({
  label, initialContent, submitLabel, onSubmit,
}: {
  label: string;
  initialContent: string;
  submitLabel: string;
  onSubmit: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState(initialContent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(content.trim());
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, "Échec de l'enregistrement."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => { void handleSubmit(event); }} aria-label={label} style={{ marginTop: '8px' }}>
      <label style={{ display: 'block' }}>
        Contenu du contrat
        <textarea
          aria-label="Contenu du contrat"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          required
          style={textareaStyle}
        />
      </label>
      <Button type="submit" disabled={submitting || content.trim() === ''} style={{ marginTop: '8px' }}>
        {submitting ? 'Enregistrement…' : submitLabel}
      </Button>
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </form>
  );
}

function VersionBlock({
  contract, isLatest, organizationId, onChanged,
}: { contract: ContractVersion; isLatest: boolean; organizationId: string; onChanged: () => void }) {
  const api = useApiClient();
  const [pending, setPending] = useState<ContractAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transition(action: ContractAction) {
    setPending(action);
    setError(null);
    try {
      await api.transitionContract(contract.id, organizationId, action);
      onChanged();
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, 'Transition refusée.'));
      setPending(null);
    }
  }

  return (
    <article
      aria-label={`Version ${contract.version}`}
      style={{
        border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '8px', padding: '12px', marginTop: '8px',
      }}
    >
      <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em' }}>{SIMULATION_NOTICE}</p>
      <p style={{ margin: '6px 0' }}>
        <strong>Version {contract.version}</strong>
        {' · '}
        <span data-testid="contract-status">{contract.status_label}</span>
        {' · rédigée par '}
        {contract.authored_by}
        {contract.approved_at && ` · approuvée le ${formatDate(contract.approved_at)} par ${contract.approved_by}`}
        {contract.signed_at && ` · signée par le client (simulation) le ${formatDate(contract.signed_at)}`}
      </p>

      {contract.status === 'draft' ? (
        <ContentForm
          label={`Modifier la version ${contract.version}`}
          initialContent={contract.content}
          submitLabel="Enregistrer le brouillon"
          onSubmit={async (content) => {
            await api.updateContract(contract.id, organizationId, content);
            onChanged();
          }}
        />
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{contract.content}</pre>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
        {contract.status === 'draft' && (
          <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => { void transition('submit'); }}>
            Soumettre pour revue
          </Button>
        )}
        {contract.status === 'review' && (
          <>
            <Button type="button" disabled={pending !== null} onClick={() => { void transition('approve'); }}>
              Approuver le contenu
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending !== null}
              onClick={() => { void transition('back_to_draft'); }}
            >
              Revenir en brouillon
            </Button>
          </>
        )}
      </div>
      {contract.status === 'approved' && isLatest && (
        <p style={{ margin: '8px 0 0' }}>En attente de la signature simulée du client.</p>
      )}
      {contract.status === 'approved' && !isLatest && (
        <p style={{ margin: '8px 0 0' }}>Remplacée par une version plus récente : n&apos;est plus signable.</p>
      )}
      {error && <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>}
    </article>
  );
}

export function AdminContractPanel({ reservation }: { reservation: AdminReservation }) {
  const api = useApiClient();
  const organizationId = reservation.organization.id;
  // Une nouvelle version rend la précédente non signable : repliée derrière
  // un bouton explicite dès qu'une version existe, jamais un formulaire
  // pré-rempli affiché en permanence au-dessus d'une version en attente de
  // signature (retour de vérification en navigateur).
  const [newVersionOpen, setNewVersionOpen] = useState(false);
  const state = useApiResource(
    () => api.listContracts(reservation.id, organizationId),
    [reservation.id, organizationId],
  );

  if (state.status === 'loading') return <p style={{ margin: '8px 0 0' }}>Chargement du contrat…</p>;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger le contrat." onRetry={state.refetch} />;
  }

  const versions = [...state.data].sort((a, b) => b.version - a.version);
  const latest = versions[0];
  const hasVersionInProgress = versions.some((contract) => contract.status === 'draft' || contract.status === 'review');
  const canCreate = ACTIVE_RESERVATION_STATUSES.includes(reservation.status) && !hasVersionInProgress;

  return (
    <section aria-label={`Contrat — ${reservation.lot.name}`} style={{ marginTop: '12px' }}>
      <strong>Contrat</strong>
      {versions.length === 0 && <p style={{ margin: '4px 0 0' }}>Aucune version rédigée.</p>}
      {canCreate && latest && !newVersionOpen && (
        <div style={{ marginTop: '8px' }}>
          <Button type="button" variant="secondary" onClick={() => setNewVersionOpen(true)}>
            Corriger : créer une nouvelle version
          </Button>
          {latest.status === 'approved' && (
            <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
              La version {latest.version}, en attente de signature, ne sera alors plus signable.
            </p>
          )}
        </div>
      )}
      {canCreate && (!latest || newVersionOpen) && (
        <ContentForm
          label={latest ? `Nouvelle version (v${latest.version + 1})` : 'Rédiger le contrat'}
          initialContent={latest ? latest.content : ''}
          submitLabel={latest ? 'Créer la nouvelle version' : 'Créer le brouillon'}
          onSubmit={async (content) => {
            await api.createContract(reservation.id, organizationId, content);
            setNewVersionOpen(false);
            state.refetch();
          }}
        />
      )}
      {versions.map((contract) => (
        <VersionBlock
          key={contract.id}
          contract={contract}
          isLatest={contract.id === latest.id}
          organizationId={organizationId}
          onChanged={state.refetch}
        />
      ))}
    </section>
  );
}
