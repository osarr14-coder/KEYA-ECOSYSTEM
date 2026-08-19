import { useState } from 'react';

import { AlertBanner, StatusBadge } from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { EvidenceSummary, LotExceptionRow, ReserveExceptionRow } from '../api/types';
import { useApiResource } from '../api/useApiResource';

export interface ExceptionsViewProps {
  /** Bascule vers l'onglet "Tous les lots" en filtrant sur ce lot — action
   * réelle de navigation, jamais un lien mort. */
  onViewLotInTable: (lotName: string) => void;
  /** Ticket 019 — organisation active résolue par `App.tsx` (App Switcher).
   * Dans les deps de `useApiResource` ci-dessous, ET transmise à
   * `CapaciteManquanteRow` pour « Affecter à mon organisation », qui
   * n'appelle plus `getMe()` lui-même (une seule résolution de
   * l'organisation active, au niveau App, jamais dupliquée). */
  activeOrganizationId: string | null;
}

function LotRowList({
  rows, emptyMessage, onViewLotInTable,
}: {
  rows: LotExceptionRow[];
  emptyMessage: string;
  onViewLotInTable: (lotName: string) => void;
}) {
  if (rows.length === 0) {
    return <p>{emptyMessage}</p>;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {rows.map((row) => (
        <li key={`${row.lot_id}-${row.work_declaration_id ?? ''}`}>
          <strong>{row.lot_name}</strong>
          <span> — {row.asset_name} ({row.program_name})</span>
          <p>{row.label}</p>
          <button type="button" onClick={() => onViewLotInTable(row.lot_name)}>
            Voir dans Tous les lots
          </button>
        </li>
      ))}
    </ul>
  );
}

function CapaciteManquanteRow({
  row, onAssigned, activeOrganizationId,
}: {
  row: LotExceptionRow;
  onAssigned: () => void;
  activeOrganizationId: string | null;
}) {
  const api = useApiClient();
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssign() {
    setAssigning(true);
    setError(null);
    try {
      // Ticket 019 : l'organisation active vient de `App.tsx` (App
      // Switcher), plus d'un `getMe()` propre qui prenait aveuglément
      // `memberships[0]` — même angle mort que celui corrigé ailleurs par
      // ce ticket, déjà présent en production avant cette correction.
      if (!activeOrganizationId) {
        setError('Aucune organisation active.');
        return;
      }
      await api.assignLotOrganization(row.lot_id, activeOrganizationId);
      onAssigned();
    } catch {
      setError("Échec de l'affectation.");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <li>
      <strong>{row.lot_name}</strong>
      <span> — {row.asset_name} ({row.program_name})</span>
      <p>{row.label}</p>
      <button type="button" onClick={handleAssign} disabled={assigning}>
        Affecter à mon organisation
      </button>
      {error && <p role="alert">{error}</p>}
    </li>
  );
}

function ReserveCorrectionForm({
  row, onSubmitted,
}: {
  row: ReserveExceptionRow;
  onSubmitted: () => void;
}) {
  const api = useApiClient();
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>(row.available_evidence[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedEvidenceId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createReserveCorrection(row.reserve_id, selectedEvidenceId);
      onSubmitted();
    } catch {
      setError('Échec de la soumission de la correction.');
    } finally {
      setSubmitting(false);
    }
  }

  if (row.available_evidence.length === 0) {
    return <p>Ajoutez une preuve pour ce lot avant de documenter une correction.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Preuve justifiant la correction
        <select
          aria-label={`Preuve pour la réserve du lot ${row.lot_name}`}
          value={selectedEvidenceId}
          onChange={(event) => setSelectedEvidenceId(event.target.value)}
        >
          {row.available_evidence.map((evidence: EvidenceSummary) => (
            <option key={evidence.id} value={evidence.id}>
              {evidence.milestone_label} — {evidence.added_by_email} — {new Date(evidence.created_at).toLocaleString('fr-FR')}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={submitting}>Documenter une correction</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function ReserveOuverteRow({ row, onSubmitted }: { row: ReserveExceptionRow; onSubmitted: () => void }) {
  return (
    <li>
      <AlertBanner title="Réserve ouverte">
        {row.lot_name} — {row.asset_name} ({row.program_name}). {row.label}
      </AlertBanner>
      <StatusBadge level={row.event.level} event={{ ...row.event, createdAt: row.event.created_at }} />
      <ReserveCorrectionForm row={row} onSubmitted={onSubmitted} />
    </li>
  );
}

function DocumentManquantRow({ row, onAdded }: { row: LotExceptionRow; onAdded: () => void }) {
  const api = useApiClient();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !row.work_declaration_id) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.addEvidenceDocument({
        workDeclarationId: row.work_declaration_id, file,
        category: 'preuve_chantier', source: 'control_tower_upload',
      });
      onAdded();
    } catch {
      setError("Échec de l'ajout de la preuve.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li>
      <strong>{row.lot_name}</strong>
      <span> — {row.asset_name} ({row.program_name})</span>
      <p>{row.label}</p>
      <form onSubmit={handleSubmit}>
        <label>
          Ajouter une preuve
          <input
            type="file"
            aria-label={`Ajouter une preuve pour ${row.lot_name}`}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" disabled={submitting || !file}>Ajouter une preuve</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </li>
  );
}

export function ExceptionsView({ onViewLotInTable, activeOrganizationId }: ExceptionsViewProps) {
  const api = useApiClient();
  const [reloadKey, setReloadKey] = useState(0);
  const state = useApiResource(() => api.getExceptions(), [reloadKey, activeOrganizationId]);
  const reload = () => setReloadKey((key) => key + 1);

  if (state.status === 'loading') {
    return <p>Chargement…</p>;
  }
  if (state.status === 'error') {
    return <p role="alert">Impossible de charger les exceptions.</p>;
  }

  const exceptions = state.data;
  const totalCount = (
    exceptions.lots_en_retard.length
    + exceptions.controles_a_planifier.length
    + exceptions.capacites_manquantes.length
    + exceptions.reserves_ouvertes.length
    + exceptions.documents_manquants.length
  );

  return (
    <section aria-label="Exceptions">
      {totalCount === 0 && (
        <p data-testid="no-exceptions">Aucune exception en ce moment — tout est à jour.</p>
      )}

      <div>
        <h2>Lots en retard</h2>
        <LotRowList
          rows={exceptions.lots_en_retard}
          emptyMessage="Aucun lot en retard."
          onViewLotInTable={onViewLotInTable}
        />
      </div>

      <div>
        <h2>Contrôles à planifier</h2>
        <LotRowList
          rows={exceptions.controles_a_planifier}
          emptyMessage="Aucun contrôle en attente de planification."
          onViewLotInTable={onViewLotInTable}
        />
      </div>

      <div>
        <h2>Capacités manquantes</h2>
        {exceptions.capacites_manquantes.length === 0 ? (
          <p>Tous les lots ont une organisation constructrice affectée.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {exceptions.capacites_manquantes.map((row) => (
              <CapaciteManquanteRow
                key={row.lot_id}
                row={row}
                onAssigned={reload}
                activeOrganizationId={activeOrganizationId}
              />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2>Réserves ouvertes</h2>
        {exceptions.reserves_ouvertes.length === 0 ? (
          <p>Aucune réserve ouverte.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {exceptions.reserves_ouvertes.map((row) => (
              <ReserveOuverteRow key={row.reserve_id} row={row} onSubmitted={reload} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2>Documents manquants</h2>
        {exceptions.documents_manquants.length === 0 ? (
          <p>Aucun document manquant.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {exceptions.documents_manquants.map((row) => (
              <DocumentManquantRow
                key={`${row.lot_id}-${row.work_declaration_id}`} row={row} onAdded={reload}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
