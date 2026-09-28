import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, Button, Card, Input, Select, TrustEventLine, semanticColors, PageHeader, formatServerDateTime,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import type { EvidenceSummary, LotExceptionRow, ReserveExceptionRow } from '../api/types';
import { useApiResource } from '../api/useApiResource';

export interface ExceptionsViewProps {
  /** Bascule vers l'onglet "Tous les lots" en filtrant sur ce lot — action
   * réelle de navigation, jamais un lien mort. */
  onViewLotInTable: (lotName: string) => void;
  /** Ticket 019 — organisation active résolue par `App.tsx` (App Switcher),
   * dans les deps de `useApiResource` ci-dessous. (PO-2026-09-28-15 : plus
   * d'action « Affecter à mon organisation ».) */
  activeOrganizationId: string | null;
}

// Ticket 023 (polish visuel) — une seule carte de ligne partagée par les 4
// types de ligne d'exception (lot en retard, capacité manquante, réserve
// ouverte, document manquant), jamais redéfinie séparément à chaque fois.
// Ticket F-054 (refonte visuelle, suite de F-053) — ombre + rayon 8px→14px,
// même traitement que `Card` (packages/design-system).
// PO-2026-09-27-20 (V04) : plus de carte dans la carte — lignes séparées
// par un filet.
const ROW_STYLE = {
  padding: '12px 0',
  borderTop: `1px solid ${semanticColors.neutral.border}`,
};

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
    <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {rows.map((row) => (
        <li key={`${row.lot_id}-${row.work_declaration_id ?? ''}`} style={ROW_STYLE}>
          <strong>{row.lot_name}</strong>
          <span> — {row.asset_name} ({row.program_name})</span>
          <p>{row.label}</p>
          <Button type="button" variant="secondary" onClick={() => onViewLotInTable(row.lot_name)}>
            Voir dans Tous les lots
          </Button>
        </li>
      ))}
    </ul>
  );
}

function CapaciteManquanteRow({ row }: { row: LotExceptionRow }) {
  // PO-2026-09-28-15 : l'affectation d'une organisation constructrice est
  // réservée au gestionnaire, côté serveur. Le constructeur la voit en
  // lecture seule — aucune action ici.
  return (
    <li style={ROW_STYLE}>
      <strong>{row.lot_name}</strong>
      <span> — {row.asset_name} ({row.program_name})</span>
      <p style={{ margin: '4px 0' }}>{row.label}</p>
      {/* PO-2026-09-28-21 : le constructeur sait pourquoi il ne peut pas agir. */}
      <p style={{ margin: 0, fontSize: '14px', color: semanticColors.neutral.textMuted }}>
        Affectation réalisée par le gestionnaire
      </p>
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
        <Select
          aria-label={`Preuve pour la réserve du lot ${row.lot_name}`}
          value={selectedEvidenceId}
          onChange={(event) => setSelectedEvidenceId(event.target.value)}
        >
          {row.available_evidence.map((evidence: EvidenceSummary) => (
            <option key={evidence.id} value={evidence.id}>
              {evidence.milestone_label} — {evidence.added_by} — {formatServerDateTime(evidence.created_at)}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" disabled={submitting}>Documenter une correction</Button>
      {error && <div style={{ marginTop: '8px' }}><AlertBanner title={error} /></div>}
    </form>
  );
}

function ReserveOuverteRow({ row, onSubmitted }: { row: ReserveExceptionRow; onSubmitted: () => void }) {
  return (
    <li style={ROW_STYLE}>
      <AlertBanner title="Réserve ouverte">
        {`${row.lot_name} — ${row.asset_name} (${row.program_name}). `}
        {/* PO-2026-09-28-07 (K02) : motif et action attendue structurés. */}
        <span style={{ display: 'block' }}>{`Motif : ${row.motif ?? row.label}`}</span>
        {row.expected_action && <span style={{ display: 'block' }}>{`Action attendue : ${row.expected_action}`}</span>}
      </AlertBanner>
      <div style={{ margin: '8px 0' }}>
        {/* PO-2026-09-28-04 : niveau atteint en ligne datée, jamais en badge. */}
        <TrustEventLine event={{ ...row.event, createdAt: row.event.created_at }} />
      </div>
      <ReserveCorrectionForm row={row} onSubmitted={onSubmitted} />
    </li>
  );
}

function DocumentManquantRow({ row, onAdded }: { row: LotExceptionRow; onAdded: () => void }) {
  const api = useApiClient();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !row.work_declaration_id) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.addEvidenceDocument({
        workDeclarationId: row.work_declaration_id, file,
        category: 'preuve_chantier', source: 'control_tower_upload',
      });
      if (result.duplicateOf) {
        // Ticket F-052 — jamais bloquant (B-040), mais `onAdded()`
        // déclenche le rechargement de la liste d'exceptions, qui ferait
        // disparaître cette ligne avant que l'avertissement soit vu. On
        // laisse la ligne visible avec le bandeau, `onAdded()` n'est
        // appelé qu'au clic explicite sur « Continuer ».
        setDuplicateOf(result.duplicateOf);
      } else {
        onAdded();
      }
    } catch {
      setError("Échec de l'ajout de la preuve.");
    } finally {
      setSubmitting(false);
    }
  }

  if (duplicateOf) {
    return (
      <li style={ROW_STYLE}>
        <strong>{row.lot_name}</strong>
        <span> — {row.asset_name} ({row.program_name})</span>
        <AlertBanner title="Preuve ajoutée, mais identique à un document déjà existant">
          Ce fichier semble être un doublon exact d&apos;un document déjà présent dans cette
          organisation — vérifiez qu&apos;il ne s&apos;agit pas d&apos;une réutilisation par erreur.
        </AlertBanner>
        <div style={{ marginTop: '8px' }}>
          <Button type="button" onClick={onAdded}>Continuer</Button>
        </div>
      </li>
    );
  }

  return (
    <li style={ROW_STYLE}>
      <strong>{row.lot_name}</strong>
      <span> — {row.asset_name} ({row.program_name})</span>
      <p>{row.label}</p>
      <form onSubmit={handleSubmit}>
        <label>
          Ajouter une preuve
          <Input
            type="file"
            aria-label={`Ajouter une preuve pour ${row.lot_name}`}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Button type="submit" disabled={submitting || !file}>Ajouter une preuve</Button>
        {error && <div style={{ marginTop: '8px' }}><AlertBanner title={error} /></div>}
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
    return <ApiErrorBanner error={state.error} title="Impossible de charger les exceptions." onRetry={state.refetch} />;
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
    <section aria-label="Exceptions" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <PageHeader
        title="À traiter en priorité"
        subtitle="Lots en retard, déclarations en attente de contrôle, capacités manquantes et réserves ouvertes : ce qui demande votre attention."
      />
      {totalCount === 0 && (
        <p data-testid="no-exceptions">Aucune exception en ce moment — tout est à jour.</p>
      )}

      <Card title="Lots en retard" icon="alert-triangle">
        <LotRowList
          rows={exceptions.lots_en_retard}
          emptyMessage="Aucun lot en retard."
          onViewLotInTable={onViewLotInTable}
        />
      </Card>

      {/* PO-2026-09-28-08 (J03) : le constructeur n'organise pas son
          contrôle ; il voit seulement ses déclarations qui attendent l'avis du
          contrôleur, sans action de planification. */}
      <Card title="Déclarations en attente de contrôle" icon="clipboard-check">
        <LotRowList
          rows={exceptions.controles_a_planifier}
          emptyMessage="Aucune déclaration en attente de contrôle."
          onViewLotInTable={onViewLotInTable}
        />
        {exceptions.controles_a_planifier.length > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: '14px', color: semanticColors.neutral.textMuted }}>
            Le contrôleur est désigné indépendamment du constructeur ; les modalités de désignation et de rémunération seront définies pour le Projet 1.
          </p>
        )}
      </Card>

      <Card title="Capacités manquantes" icon="users">
        {exceptions.capacites_manquantes.length === 0 ? (
          <p>Tous les lots ont une organisation constructrice affectée.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {exceptions.capacites_manquantes.map((row) => (
              <CapaciteManquanteRow key={row.lot_id} row={row} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Réserves ouvertes" icon="alert-triangle">
        {exceptions.reserves_ouvertes.length === 0 ? (
          <p>Aucune réserve ouverte.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {exceptions.reserves_ouvertes.map((row) => (
              <ReserveOuverteRow key={row.reserve_id} row={row} onSubmitted={reload} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Documents manquants" icon="file-text">
        {exceptions.documents_manquants.length === 0 ? (
          <p>Aucun document manquant.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {exceptions.documents_manquants.map((row) => (
              <DocumentManquantRow
                key={`${row.lot_id}-${row.work_declaration_id}`} row={row} onAdded={reload}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
