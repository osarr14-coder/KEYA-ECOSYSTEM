import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { ContractVersion } from '../api/types';
import { useApiResource } from '../api/useApiResource';

/**
 * Ticket F-066 (partie 2) — contrat fictif d'une réservation, côté client
 * (backend B-049, CDC V3 §6.2). Le serveur ne renvoie que les versions
 * approuvées ou signées ; il décide seul de ce qui est signable (dernière
 * version, approuvée, réservation encore active) — cet écran n'affiche le
 * bouton que pour une version approuvée et laisse le serveur trancher.
 *
 * Marquage CDC §3.1 : « SIMULÉ — SANS VALEUR OPÉRATIONNELLE » sur l'acte,
 * jamais une signature présentée comme réelle.
 */

const SIMULATION_NOTICE = 'SIMULÉ — SANS VALEUR OPÉRATIONNELLE · DÉMONSTRATION — DONNÉES FICTIVES';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Abidjan',
  });
}

function errorDetail(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && caught.body && typeof caught.body === 'object' && 'detail' in caught.body) {
    return String((caught.body as { detail: unknown }).detail);
  }
  return fallback;
}

function ContractVersionBlock({ contract, onSigned }: { contract: ContractVersion; onSigned: () => void }) {
  const api = useApiClient();
  const [acknowledged, setAcknowledged] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sign() {
    setSigning(true);
    setError(null);
    try {
      await api.signContract(contract.id);
      onSigned();
    } catch (caught) {
      setError(errorDetail(caught, 'La signature a échoué. Réessayez.'));
      setSigning(false);
    }
  }

  return (
    <article
      aria-label={`Contrat version ${contract.version}`}
      style={{ border: '1px solid var(--keya-border, #E5E7EB)', borderRadius: '8px', padding: '12px', marginTop: '8px' }}
    >
      <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em' }}>{SIMULATION_NOTICE}</p>
      <p style={{ margin: '6px 0' }}>
        <strong>Version {contract.version}</strong>
        {' · '}
        <span data-testid="contract-status">{contract.status_label}</span>
        {contract.approved_at && ` · approuvée le ${formatDate(contract.approved_at)}`}
        {contract.signed_at && ` · signée (simulation) le ${formatDate(contract.signed_at)}`}
      </p>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '0 0 8px' }}>{contract.content}</pre>

      {contract.status === 'approved' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
          <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            J&apos;ai lu cette version du contrat et je comprends que sa signature est simulée.
          </label>
          <Button type="button" onClick={() => { void sign(); }} disabled={!acknowledged || signing}>
            {signing ? 'Signature…' : 'Signer (simulation)'}
          </Button>
        </div>
      )}
      {error && (
        <div style={{ marginTop: '8px' }}>
          <AlertBanner title={error} />
        </div>
      )}
    </article>
  );
}

export function ClientContractPanel({ reservationId }: { reservationId: string }) {
  const api = useApiClient();
  const state = useApiResource(() => api.getMyContracts(reservationId), [reservationId]);

  if (state.status === 'loading') return <p style={{ margin: '8px 0 0' }}>Chargement du contrat…</p>;
  if (state.status === 'error') {
    return <ApiErrorBanner error={state.error} title="Impossible de charger le contrat." onRetry={state.refetch} />;
  }
  if (state.data.length === 0) {
    return <p style={{ margin: '8px 0 0' }}>Contrat : en cours de préparation par le gestionnaire.</p>;
  }
  // Plus récente d'abord : c'est elle qui est signable ; les précédentes
  // restent consultables.
  const versions = [...state.data].sort((a, b) => b.version - a.version);
  return (
    <div style={{ marginTop: '8px' }}>
      <strong>Contrat</strong>
      {versions.map((contract) => (
        <ContractVersionBlock key={contract.id} contract={contract} onSigned={state.refetch} />
      ))}
    </div>
  );
}
