import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { Asset, Lot, OrganizationSearchResult, Program } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { ProgramsView } from './ProgramsView';

const ORGANIZATION: OrganizationSearchResult = { id: 'org-1', name: 'Promoteur Baobab SARL' };
const PROGRAM: Program = { id: 'program-1', name: 'Résidence Test', created_at: '2026-08-23T10:00:00Z' };
const ASSET: Asset = { id: 'asset-1', name: 'Bâtiment A', program: PROGRAM.id, created_at: '2026-08-23T10:05:00Z' };
const LOT: Lot = {
  id: 'lot-1', name: 'Lot 101', asset: ASSET.id, assigned_organization: null, surface: '45.50', created_at: '2026-08-23T10:10:00Z',
};

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    searchOrganizations: vi.fn().mockResolvedValue([ORGANIZATION]),
    createProgram: vi.fn().mockResolvedValue(PROGRAM),
    createAsset: vi.fn().mockResolvedValue(ASSET),
    createLot: vi.fn().mockResolvedValue(LOT),
    ...overrides,
  });
  render(withApiClient(api, <ProgramsView />));
  return { api };
}

async function selectOrganization() {
  fireEvent.change(screen.getByLabelText("Rechercher l'organisation cible (nom)"), { target: { value: 'Baobab' } });
  fireEvent.click(await screen.findByRole('button', { name: ORGANIZATION.name }));
}

async function selectOrganizationAndCreateProgram() {
  await selectOrganization();
  fireEvent.change(screen.getByLabelText('Nom du programme'), { target: { value: PROGRAM.name } });
  fireEvent.click(screen.getByRole('button', { name: 'Créer ce programme' }));
  await screen.findByRole('heading', { name: `Programme : ${PROGRAM.name}` });
}

describe('ProgramsView — flux de création en une session (ticket F-049/B-039)', () => {
  it('affiche le sélecteur d\'organisation en premier, aucun formulaire de programme avant sélection', () => {
    renderView();

    expect(screen.getByLabelText("Rechercher l'organisation cible (nom)")).toBeInTheDocument();
    expect(screen.queryByLabelText('Nom du programme')).not.toBeInTheDocument();
  });

  it('sélectionner une organisation affiche le formulaire de création de programme', async () => {
    renderView();
    await selectOrganization();

    expect(screen.getByText(ORGANIZATION.name)).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du programme')).toBeInTheDocument();
  });

  it('créer un programme appelle createProgram avec l\'organisation cible et affiche le programme créé', async () => {
    const createProgram = vi.fn().mockResolvedValue(PROGRAM);
    renderView({ createProgram });
    await selectOrganization();

    fireEvent.change(screen.getByLabelText('Nom du programme'), { target: { value: PROGRAM.name } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer ce programme' }));

    expect(await screen.findByRole('heading', { name: `Programme : ${PROGRAM.name}` })).toBeInTheDocument();
    expect(createProgram).toHaveBeenCalledWith({ organization: ORGANIZATION.id, name: PROGRAM.name });
    expect(screen.queryByLabelText('Nom du programme')).not.toBeInTheDocument();
  });

  it('un échec de création de programme affiche le message backend, sans faire disparaître le formulaire', async () => {
    renderView({ createProgram: vi.fn().mockRejectedValue(new ApiError(400, 'x', undefined, { name: ['Ce champ est requis.'] })) });
    await selectOrganization();

    fireEvent.change(screen.getByLabelText('Nom du programme'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer ce programme' }));

    expect(await screen.findByText('Ce champ est requis.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du programme')).toBeInTheDocument();
  });

  it('ajouter un bien appelle createAsset avec organisation/programme et affiche une carte pour ce bien', async () => {
    const createAsset = vi.fn().mockResolvedValue(ASSET);
    renderView({ createAsset });
    await selectOrganizationAndCreateProgram();

    fireEvent.change(screen.getByLabelText('Nom du bien'), { target: { value: ASSET.name } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ce bien' }));

    expect(await screen.findByRole('heading', { name: ASSET.name })).toBeInTheDocument();
    expect(createAsset).toHaveBeenCalledWith({
      organization: ORGANIZATION.id, program: PROGRAM.id, name: ASSET.name, location: '',
    });
  });

  it('ajouter un lot sous un bien appelle createLot avec l\'asset parent et affiche le lot dans sa carte', async () => {
    const createLot = vi.fn().mockResolvedValue(LOT);
    renderView({ createLot });
    await selectOrganizationAndCreateProgram();
    fireEvent.change(screen.getByLabelText('Nom du bien'), { target: { value: ASSET.name } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ce bien' }));
    await screen.findByRole('heading', { name: ASSET.name });

    fireEvent.change(screen.getByLabelText('Nom du lot'), { target: { value: LOT.name } });
    fireEvent.change(screen.getByLabelText('Surface du lot'), { target: { value: '45.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ce lot' }));

    expect(await screen.findByText(`${LOT.name} — ${LOT.surface} m²`)).toBeInTheDocument();
    expect(createLot).toHaveBeenCalledWith({
      organization: ORGANIZATION.id, asset: ASSET.id, name: LOT.name, surface: '45.50',
    });
  });

  it('"Nouveau programme" réinitialise tout l\'état (organisation, programme, biens)', async () => {
    renderView();
    await selectOrganizationAndCreateProgram();

    fireEvent.click(screen.getByRole('button', { name: 'Nouveau programme' }));

    expect(screen.getByLabelText("Rechercher l'organisation cible (nom)")).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: `Programme : ${PROGRAM.name}` })).not.toBeInTheDocument();
  });
});
