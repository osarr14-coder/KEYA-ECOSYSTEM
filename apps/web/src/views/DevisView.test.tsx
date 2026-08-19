import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { Devis, DevisAjustement } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { DevisView } from './DevisView';

const ORGANIZATION_ID = 'org-lot-1';
const LOT_ID = 'lot-1';

function makeDevis(overrides: Partial<Devis> = {}): Devis {
  return {
    id: 'devis-1',
    organization: ORGANIZATION_ID,
    candidate_organization: 'org-candidat-1',
    lot: LOT_ID,
    amount: '12500000.00',
    marge_estimee: '1500000.00',
    logged_by: 'admin-1',
    created_at: '2026-03-02T09:14:00Z',
    status: 'candidat',
    ...overrides,
  };
}

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient(overrides);
  render(withApiClient(api, <DevisView />));
  return { api };
}

async function loadLot(organizationId = ORGANIZATION_ID, lotId = LOT_ID) {
  fireEvent.change(screen.getByLabelText('Organisation du lot (UUID)'), { target: { value: organizationId } });
  fireEvent.change(screen.getByLabelText('Lot (UUID)'), { target: { value: lotId } });
  fireEvent.click(screen.getByRole('button', { name: 'Charger les devis de ce lot' }));
}

describe('DevisView — sélection manuelle du lot (ticket 027, dépendance B-028)', () => {
  it('affiche l\'avertissement sur l\'absence de sélecteur, aucun appel avant soumission', () => {
    const listDevisForLot = vi.fn();
    renderView({ listDevisForLot });

    expect(screen.getByText('Aucun sélecteur de lot/organisation disponible')).toBeInTheDocument();
    expect(listDevisForLot).not.toHaveBeenCalled();
  });

  it('soumettre le formulaire appelle listDevisForLot(lotId, organizationId) tel que saisi', async () => {
    const listDevisForLot = vi.fn().mockResolvedValue([]);
    renderView({ listDevisForLot });

    await loadLot();

    await waitFor(() => expect(listDevisForLot).toHaveBeenCalledWith(LOT_ID, ORGANIZATION_ID));
  });

  it('une liste vide affiche "Aucun devis enregistré pour ce lot.", jamais un tableau vide silencieux', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([]) });

    await loadLot();

    expect(await screen.findByTestId('no-devis')).toBeInTheDocument();
  });

  it('un échec réseau affiche une erreur explicite', async () => {
    renderView({ listDevisForLot: vi.fn().mockRejectedValue(new Error('network down')) });

    await loadLot();

    expect(await screen.findByText('Impossible de charger les devis de ce lot.')).toBeInTheDocument();
  });
});

describe('DevisView — liste des devis d\'un lot (ticket 022/027)', () => {
  it('affiche les champs réels (montant, organisation candidate en UUID brut, saisi par, date, statut)', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis()]) });

    await loadLot();

    expect(await screen.findByText('org-candidat-1')).toBeInTheDocument();
    expect(screen.getByText('12500000.00')).toBeInTheDocument();
    expect(screen.getByText('admin-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verrouiller' })).toBeInTheDocument();
  });

  it('un devis déjà verrouillé affiche "Verrouillé", jamais de bouton d\'action', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis({ status: 'devis_verrouille' })]) });

    await loadLot();

    expect(await screen.findByTestId('devis-status')).toHaveTextContent('Verrouillé');
    expect(screen.queryByRole('button', { name: 'Verrouiller' })).not.toBeInTheDocument();
  });
});

describe('DevisView — verrouillage (ticket 022/027)', () => {
  it('cliquer "Verrouiller" appelle lockDevis(devisId, organizationId), recharge la liste', async () => {
    const lockDevis = vi.fn().mockResolvedValue(makeDevis({ status: 'devis_verrouille' }));
    const listDevisForLot = vi.fn()
      .mockResolvedValueOnce([makeDevis()])
      .mockResolvedValueOnce([makeDevis({ status: 'devis_verrouille' })]);
    renderView({ listDevisForLot, lockDevis });

    await loadLot();
    fireEvent.click(await screen.findByRole('button', { name: 'Verrouiller' }));

    await waitFor(() => expect(lockDevis).toHaveBeenCalledWith('devis-1', ORGANIZATION_ID));
    expect(await screen.findByTestId('devis-status')).toHaveTextContent('Verrouillé');
    expect(listDevisForLot).toHaveBeenCalledTimes(2);
  });

  it('un autre devis déjà verrouillé sur ce lot désactive "Verrouiller" pour les autres lignes', async () => {
    renderView({
      listDevisForLot: vi.fn().mockResolvedValue([
        makeDevis({ id: 'devis-1', status: 'devis_verrouille' }),
        makeDevis({ id: 'devis-2', candidate_organization: 'org-candidat-2', status: 'candidat' }),
      ]),
    });

    await loadLot();

    const lockedElsewhereButton = await screen.findByRole('button', { name: 'Lot déjà verrouillé' });
    expect(lockedElsewhereButton).toBeDisabled();
  });

  it('un 409 (LotAlreadyLockedError) affiche le message backend exact via ApiError.detail', async () => {
    const lockDevis = vi.fn().mockRejectedValue(
      new ApiError(409, 'Échec', 'Un devis est déjà verrouillé pour ce lot — un seul devis verrouillé par lot.'),
    );
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis()]), lockDevis });

    await loadLot();
    fireEvent.click(await screen.findByRole('button', { name: 'Verrouiller' }));

    expect(await screen.findByText('Un devis est déjà verrouillé pour ce lot — un seul devis verrouillé par lot.')).toBeInTheDocument();
  });
});

describe('DevisView — enregistrer une candidature reçue hors plateforme (ticket 022/027)', () => {
  it('soumettre le formulaire appelle createDevis avec organization/lot/candidate_organization/amount, recharge la liste', async () => {
    const createDevis = vi.fn().mockResolvedValue(makeDevis());
    const listDevisForLot = vi.fn().mockResolvedValue([]);
    renderView({ listDevisForLot, createDevis });

    await loadLot();
    fireEvent.change(await screen.findByLabelText('Organisation candidate (UUID)'), { target: { value: 'org-candidat-9' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '9000000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la candidature' }));

    await waitFor(() => expect(createDevis).toHaveBeenCalledWith({
      organization: ORGANIZATION_ID,
      lot: LOT_ID,
      candidate_organization: 'org-candidat-9',
      amount: '9000000.00',
    }));
    expect(listDevisForLot).toHaveBeenCalledTimes(2);
  });

  it('un 409 (NoPricingConfigError) affiche le message backend exact, ne recharge pas la liste', async () => {
    const createDevis = vi.fn().mockRejectedValue(
      new ApiError(409, 'Échec', 'Aucun taux de marge (canal 1) configuré pour le pays « Sénégal » — impossible de créer un devis.'),
    );
    const listDevisForLot = vi.fn().mockResolvedValue([]);
    renderView({ listDevisForLot, createDevis });

    await loadLot();
    fireEvent.change(await screen.findByLabelText('Organisation candidate (UUID)'), { target: { value: 'org-candidat-9' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '9000000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la candidature' }));

    expect(await screen.findByText('Aucun taux de marge (canal 1) configuré pour le pays « Sénégal » — impossible de créer un devis.')).toBeInTheDocument();
    expect(listDevisForLot).toHaveBeenCalledTimes(1);
  });
});

describe('DevisView — réconciliation / ajustements (ticket 023/024/027)', () => {
  function makeAjustement(overrides: Partial<DevisAjustement> = {}): DevisAjustement {
    return {
      id: 'ajustement-1',
      devis: 'devis-1',
      organization: ORGANIZATION_ID,
      ecart: '-200000.00',
      created_by: 'admin-1',
      created_at: '2026-03-10T10:05:00Z',
      ...overrides,
    };
  }

  it('le panneau d\'ajustements n\'apparaît que pour un devis verrouillé', async () => {
    renderView({
      listDevisForLot: vi.fn().mockResolvedValue([makeDevis({ status: 'candidat' })]),
    });

    await loadLot();
    await screen.findByText('org-candidat-1');

    expect(screen.queryByText('Aucun ajustement enregistré pour l\'instant.')).not.toBeInTheDocument();
  });

  it('un devis verrouillé SANS ajustement affiche "encore Candidat" côté vue candidat', async () => {
    renderView({
      listDevisForLot: vi.fn().mockResolvedValue([makeDevis({ status: 'devis_verrouille' })]),
      listAjustements: vi.fn().mockResolvedValue([]),
    });

    await loadLot();

    const note = await screen.findByTestId('candidate-visible-status');
    expect(note).toHaveAttribute('data-status', 'candidat');
    expect(note).toHaveTextContent('encore « Candidat »');
    expect(await screen.findByText('Aucun ajustement enregistré pour l\'instant.')).toBeInTheDocument();
  });

  it('un devis verrouillé AVEC au moins un ajustement affiche "Gagnant" côté vue candidat', async () => {
    renderView({
      listDevisForLot: vi.fn().mockResolvedValue([makeDevis({ status: 'devis_verrouille' })]),
      listAjustements: vi.fn().mockResolvedValue([makeAjustement()]),
    });

    await loadLot();

    const note = await screen.findByTestId('candidate-visible-status');
    expect(note).toHaveAttribute('data-status', 'gagnant');
    expect(note).toHaveTextContent('« Gagnant »');
    expect(screen.getByText('-200000.00')).toBeInTheDocument();
  });

  it('enregistrer un ajustement appelle createAjustement(devisId, {organization, ecart}), recharge la liste des ajustements', async () => {
    const createAjustement = vi.fn().mockResolvedValue({ ...makeAjustement(), marge_resultante: '1700000.00' });
    const listAjustements = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeAjustement()]);
    renderView({
      listDevisForLot: vi.fn().mockResolvedValue([makeDevis({ status: 'devis_verrouille' })]),
      listAjustements,
      createAjustement,
    });

    await loadLot();
    await screen.findByText('Aucun ajustement enregistré pour l\'instant.');

    fireEvent.change(screen.getByLabelText('Écart'), { target: { value: '-200000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer un ajustement' }));

    await waitFor(() => expect(createAjustement).toHaveBeenCalledWith('devis-1', {
      organization: ORGANIZATION_ID,
      ecart: '-200000.00',
    }));
    expect(await screen.findByText('-200000.00')).toBeInTheDocument();
    expect(listAjustements).toHaveBeenCalledTimes(2);
  });

  it('un 409 (MarginExceededError) affiche le message backend exact', async () => {
    const createAjustement = vi.fn().mockRejectedValue(
      new ApiError(409, 'Échec', 'Écart (5000000.00) au-delà de la marge disponible (1500000.00).'),
    );
    renderView({
      listDevisForLot: vi.fn().mockResolvedValue([makeDevis({ status: 'devis_verrouille' })]),
      listAjustements: vi.fn().mockResolvedValue([]),
      createAjustement,
    });

    await loadLot();
    await screen.findByText('Aucun ajustement enregistré pour l\'instant.');

    fireEvent.change(screen.getByLabelText('Écart'), { target: { value: '5000000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer un ajustement' }));

    expect(await screen.findByText('Écart (5000000.00) au-delà de la marge disponible (1500000.00).')).toBeInTheDocument();
  });
});
