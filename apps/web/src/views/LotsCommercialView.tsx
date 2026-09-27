import { type FormEvent, useState } from 'react';

import {
  Button, Card, Input, Select,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type { CommercialLot, LotCommercialStatus } from '../api/types';
import { LiveSearchPicker } from '../components/LiveSearchPicker';

/**
 * Ticket F-064 — prix de vente et statut commercial des lots, jusqu'ici
 * modifiables uniquement par appel direct à l'API (tickets B-042/B-047).
 * Recherche d'un lot EXISTANT, toutes organisations confondues : l'assistant
 * `ProgramsView.tsx` ne connaît que les lots créés dans sa propre session.
 */

const STATUS_LABELS: Record<LotCommercialStatus, string> = {
  disponible: 'Disponible',
  reserve: 'Réservé',
  vendu: 'Vendu',
};

function LotCommercialEditor({
  lot, canEditPrice, onSaved,
}: { lot: CommercialLot; canEditPrice: boolean; onSaved: (lot: CommercialLot) => void }) {
  const api = useApiClient();
  const [status, setStatus] = useState<LotCommercialStatus>(lot.commercial_status);
  const [price, setPrice] = useState(lot.sale_price ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    // Seuls les champs réellement modifiés partent : le prix de vente est
    // réservé à admin_keyimmo (B-047), le renvoyer inchangé ferait refuser
    // un simple changement de statut à tout autre rôle.
    const payload: { commercial_status?: LotCommercialStatus; sale_price?: string } = {};
    if (status !== lot.commercial_status) payload.commercial_status = status;
    const trimmedPrice = price.trim();
    if (canEditPrice && trimmedPrice !== '' && trimmedPrice !== (lot.sale_price ?? '')) {
      payload.sale_price = trimmedPrice;
    }

    if (Object.keys(payload).length === 0) {
      setError('Aucune modification à enregistrer.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await api.updateLotCommercial(lot.id, lot.organization.id, payload);
      onSaved({ ...lot, commercial_status: updated.commercial_status, sale_price: updated.sale_price });
      setPrice(updated.sale_price ?? '');
      setSaved(true);
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, "Échec de l'enregistrement."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title={lot.name} icon="building">
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0 }}>
        <dt>Organisation</dt>
        <dd style={{ margin: 0 }}>{lot.organization.name}</dd>
        <dt>Programme</dt>
        <dd style={{ margin: 0 }}>{lot.program.name}</dd>
        <dt>Bien</dt>
        <dd style={{ margin: 0 }}>{lot.asset.name}</dd>
        <dt>Surface</dt>
        <dd style={{ margin: 0 }}>{lot.surface ? `${lot.surface} m²` : 'Non renseignée'}</dd>
        <dt>Statut actuel</dt>
        <dd style={{ margin: 0 }}>{STATUS_LABELS[lot.commercial_status]}</dd>
        <dt>Prix de vente actuel</dt>
        <dd style={{ margin: 0 }}>{lot.sale_price ?? 'Non renseigné'}</dd>
      </dl>

      <form
        onSubmit={(event) => { void handleSubmit(event); }}
        aria-label="Modifier le prix et le statut"
        style={{
          marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap',
        }}
      >
        <label>
          Statut commercial
          <Select
            aria-label="Statut commercial"
            value={status}
            onChange={(event) => setStatus(event.target.value as LotCommercialStatus)}
            style={{ marginTop: '4px', width: '180px' }}
          >
            {(Object.keys(STATUS_LABELS) as LotCommercialStatus[]).map((value) => (
              <option key={value} value={value}>{STATUS_LABELS[value]}</option>
            ))}
          </Select>
        </label>
        <label>
          Prix de vente
          <Input
            type="text"
            inputMode="decimal"
            aria-label="Prix de vente"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            disabled={!canEditPrice}
            aria-describedby={canEditPrice ? undefined : 'sale-price-restricted'}
            style={{ marginTop: '4px', width: '180px' }}
          />
        </label>
        {!canEditPrice && (
          <p id="sale-price-restricted" style={{ width: '100%', margin: 0, fontSize: '13px' }}>
            Le prix de vente est réservé à l&apos;admin KEYIMMO — vous pouvez modifier le statut.
          </p>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
        {saved && <p role="status" style={{ width: '100%', margin: 0 }}>Modifications enregistrées.</p>}
      </form>
    </Card>
  );
}

/** `canEditPrice` : `admin_keyimmo` seul (ticket B-047) ; pour l'ADV le
 * champ est désactivé plutôt que de laisser le backend répondre 403. */
export function LotsCommercialView({ canEditPrice }: { canEditPrice: boolean }) {
  const api = useApiClient();
  const [selectedLot, setSelectedLot] = useState<CommercialLot | null>(null);

  return (
    <section aria-label="Prix et statut des lots">
      <h2>Lots — prix &amp; statut</h2>

      <Card title="Rechercher un lot" icon="search">
        <LiveSearchPicker<CommercialLot>
          label="Rechercher un lot (nom)"
          placeholder="Nom du lot…"
          searchFn={api.searchLotsForCommercial}
          getKey={(lot) => lot.id}
          renderResult={(lot) => `${lot.name} — ${lot.program.name} · ${lot.organization.name}`}
          onSelect={setSelectedLot}
        />
      </Card>

      {selectedLot && (
        <div style={{ marginTop: '16px' }}>
          <LotCommercialEditor
            key={selectedLot.id}
            lot={selectedLot}
            canEditPrice={canEditPrice}
            onSaved={setSelectedLot}
          />
        </div>
      )}
    </section>
  );
}
