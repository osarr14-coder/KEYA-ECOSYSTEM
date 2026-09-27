import { useState } from 'react';

import {
  AlertBanner, Button, Pill, semanticColors, SimulatedMark, formatServerDateTime, DEMO_MARKING,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/client';
import type { ContractVersion } from '../api/types';

/**
 * Ticket F-066 (partie 2) — contrat fictif d'une réservation, côté client
 * (backend B-049, CDC V3 §6.2). Le serveur ne renvoie que les versions
 * approuvées ou signées ; il décide seul de ce qui est signable (dernière
 * version, approuvée, réservation encore active) — cet écran n'affiche le
 * bouton que pour une version approuvée et laisse le serveur trancher.
 *
 * Marquage CDC §3.1 : « SIMULÉ — SANS VALEUR OPÉRATIONNELLE » sur l'acte,
 * jamais une signature présentée comme réelle.
 *
 * Ticket F-074 — présentationnel : les versions sont chargées par le
 * parcours d'acquisition (`AcquisitionJourney`), qui en dérive aussi
 * l'étape « Signature du contrat ».
 */


// Audit UI R1 (F06) : format de date unique, fuseau indiqué.
function formatDate(iso: string) {
  return formatServerDateTime(iso);
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
      style={{
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '6px',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <SimulatedMark detail={`Signature du contrat · ${DEMO_MARKING}`} />
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <strong>Version {contract.version}</strong>
        <Pill tone={contract.status === 'signed_simulated' ? 'success' : 'alert'} data-testid="contract-status">
          {contract.status_label}
        </Pill>
        <span style={{ color: semanticColors.neutral.textMuted, fontSize: '14px' }}>
          {contract.approved_at && `approuvée le ${formatDate(contract.approved_at)}`}
          {contract.signed_at && ` · signée (simulation) le ${formatDate(contract.signed_at)}`}
        </span>
      </p>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          margin: 0,
          padding: '14px 16px',
          borderRadius: '6px',
          background: semanticColors.neutral.subtle,
          maxHeight: '240px',
          overflowY: 'auto',
        }}
      >
        {contract.content}
      </pre>

      {contract.status === 'approved' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
          <label style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              style={{ width: '20px', height: '20px', accentColor: semanticColors.primary.background }}
            />
            J&apos;ai lu cette version du contrat et je comprends que sa signature est simulée.
          </label>
          <Button type="button" variant="accent" onClick={() => { void sign(); }} disabled={!acknowledged || signing}>
            {signing ? 'Signature…' : 'Signer (simulation)'}
          </Button>
        </div>
      )}
      {error && <AlertBanner title={error} />}
    </article>
  );
}

/** Versions visibles du contrat, de la plus récente (seule signable) à la
 * plus ancienne. */
export function ContractVersions({ contracts, onSigned }: { contracts: ContractVersion[]; onSigned: () => void }) {
  if (contracts.length === 0) {
    return <p style={{ margin: 0 }}>Contrat : en cours de préparation par le gestionnaire.</p>;
  }
  const versions = [...contracts].sort((a, b) => b.version - a.version);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {versions.map((contract) => (
        <ContractVersionBlock key={contract.id} contract={contract} onSigned={onSigned} />
      ))}
    </div>
  );
}
