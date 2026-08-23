import { type FormEvent, useState } from 'react';

import {
  Button, Card, Input,
} from '@keya/design-system';

import { useApiClient } from '../api/ApiClientContext';
import { formatDrfFieldErrors } from '../api/errors';
import type {
  Asset, Lot, OrganizationSearchResult, Program,
} from '../api/types';
import { LiveSearchPicker } from '../components/LiveSearchPicker';

/**
 * Ticket F-049 — écran de création `Program` → `Asset` → `Lot`, périmètre
 * admin_keyimmo (voir B-039, qui a verrouillé l'API mais exclu tout écran
 * frontend de son scope). Contrat API vérifié directement dans
 * `backend/apps/programs/{views,serializers,services}.py` avant d'écrire
 * ce fichier — voir F-049-creation-programme-hierarchie-admin.md.
 *
 * **Flux "wizard" en une seule session, PAS un CRUD complet** (décision de
 * périmètre documentée dans le ticket) : aucun endpoint ne permet
 * aujourd'hui à `admin_keyimmo` de lister les `Program`/`Asset` d'une
 * organisation dont il n'est pas membre — `program`/`asset` (Asset/Lot
 * parents) proviennent donc UNIQUEMENT des créations faites plus haut dans
 * CETTE session (état React local), jamais d'une recherche. Étendre un
 * `Program` créé lors d'une session précédente nécessiterait un nouvel
 * endpoint de recherche (même famille que `search_lots_as_admin`, ticket
 * B-028) — hors scope ici.
 */

function OrganizationTargetPicker({ onSelect }: { onSelect: (organization: OrganizationSearchResult) => void }) {
  const api = useApiClient();
  return (
    <LiveSearchPicker<OrganizationSearchResult>
      label="Rechercher l'organisation cible (nom)"
      placeholder="Nom de l'organisation…"
      searchFn={api.searchOrganizations}
      getKey={(organization) => organization.id}
      renderResult={(organization) => organization.name}
      onSelect={onSelect}
    />
  );
}

function CreateProgramForm({
  organizationId, onCreated,
}: { organizationId: string; onCreated: (program: Program) => void }) {
  const api = useApiClient();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const program = await api.createProgram({ organization: organizationId, name: name.trim() });
      onCreated(program);
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, 'Échec de la création du programme.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label="Créer un programme"
      style={{
        marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap',
      }}
    >
      <label>
        Nom du programme
        <Input
          type="text"
          aria-label="Nom du programme"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          style={{ marginTop: '4px', width: '280px' }}
        />
      </label>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Création…' : 'Créer ce programme'}
      </Button>
      {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function CreateAssetForm({
  organizationId, programId, onCreated,
}: { organizationId: string; programId: string; onCreated: (asset: Asset) => void }) {
  const api = useApiClient();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const asset = await api.createAsset({
        organization: organizationId, program: programId, name: name.trim(), location: location.trim(),
      });
      setName('');
      setLocation('');
      onCreated(asset);
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, 'Échec de la création du bien.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label="Ajouter un bien"
      style={{
        marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap',
      }}
    >
      <label>
        Nom du bien
        <Input
          type="text"
          aria-label="Nom du bien"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          style={{ marginTop: '4px', width: '220px' }}
        />
      </label>
      <label>
        Localisation (optionnel)
        <Input
          type="text"
          aria-label="Localisation du bien"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          style={{ marginTop: '4px', width: '220px' }}
        />
      </label>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Ajout…' : 'Ajouter ce bien'}
      </Button>
      {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function CreateLotForm({
  organizationId, assetId, onCreated,
}: { organizationId: string; assetId: string; onCreated: (lot: Lot) => void }) {
  const api = useApiClient();
  const [name, setName] = useState('');
  const [surface, setSurface] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const lot = await api.createLot({
        organization: organizationId,
        asset: assetId,
        name: name.trim(),
        surface: surface.trim() || undefined,
      });
      setName('');
      setSurface('');
      onCreated(lot);
    } catch (caught) {
      setError(formatDrfFieldErrors(caught, 'Échec de la création du lot.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { void handleSubmit(event); }}
      aria-label={`Ajouter un lot (${assetId})`}
      style={{
        marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap',
      }}
    >
      <label>
        Nom du lot
        <Input
          type="text"
          aria-label="Nom du lot"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          style={{ marginTop: '4px', width: '160px' }}
        />
      </label>
      <label>
        Surface m² (optionnel)
        <Input
          type="text"
          inputMode="decimal"
          aria-label="Surface du lot"
          value={surface}
          onChange={(event) => setSurface(event.target.value)}
          style={{ marginTop: '4px', width: '120px' }}
        />
      </label>
      <Button type="submit" disabled={submitting} variant="secondary">
        {submitting ? 'Ajout…' : 'Ajouter ce lot'}
      </Button>
      {error && <p role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function AssetCard({ organizationId, asset }: { organizationId: string; asset: Asset }) {
  const [lots, setLots] = useState<Lot[]>([]);

  return (
    <Card title={asset.name} icon="building">
      {lots.length > 0 && (
        <ul>
          {lots.map((lot) => (
            <li key={lot.id}>
              {lot.name}
              {lot.surface ? ` — ${lot.surface} m²` : ''}
            </li>
          ))}
        </ul>
      )}
      <CreateLotForm
        organizationId={organizationId}
        assetId={asset.id}
        onCreated={(lot) => setLots((current) => [...current, lot])}
      />
    </Card>
  );
}

export function ProgramsView() {
  const [organization, setOrganization] = useState<OrganizationSearchResult | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);

  function reset() {
    setOrganization(null);
    setProgram(null);
    setAssets([]);
  }

  return (
    <section aria-label="Création de programme">
      <h2>Programmes</h2>

      {!organization && (
        <Card title="1. Organisation cible" icon="building">
          <OrganizationTargetPicker onSelect={setOrganization} />
        </Card>
      )}

      {organization && !program && (
        <Card title="2. Créer le programme" icon="building">
          <p>
            Organisation cible : <strong>{organization.name}</strong>{' '}
            <Button type="button" variant="secondary" onClick={reset}>Changer</Button>
          </p>
          <CreateProgramForm organizationId={organization.id} onCreated={setProgram} />
        </Card>
      )}

      {organization && program && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <Card title={`Programme : ${program.name}`} icon="building">
            <p>
              Organisation : <strong>{organization.name}</strong>{' '}
              <Button type="button" variant="secondary" onClick={reset}>Nouveau programme</Button>
            </p>
          </Card>

          <Card title="3. Ajouter des biens" icon="building">
            <CreateAssetForm
              organizationId={organization.id}
              programId={program.id}
              onCreated={(asset) => setAssets((current) => [...current, asset])}
            />
          </Card>

          {assets.map((asset) => (
            <AssetCard key={asset.id} organizationId={organization.id} asset={asset} />
          ))}
        </div>
      )}
    </section>
  );
}
