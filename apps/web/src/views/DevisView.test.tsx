import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type {
  Devis, DevisAjustement, LotSearchResult, OrganizationSearchResult,
} from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { DevisView } from './DevisView';

const LOT_RESULT: LotSearchResult = {
  id: 'lot-1',
  name: 'Lot A12',
  organization: { id: 'org-lot-1', name: 'Org Constructeur Verif' },
  program: { id: 'program-1', name: 'Programme Verif F027' },
};

const CANDIDATE_ORG_RESULT: OrganizationSearchResult = {
  id: 'org-candidat-9',
  name: 'Bati Senegal Verif SARL',
};

/** Ticket F-029/B-029 : `candidate_organization_detail` par défaut d'un
 * devis créé par `makeDevis()` — distinct de `CANDIDATE_ORG_RESULT`
 * (utilisé pour le PICKER de candidature) afin de ne jamais confondre les
 * deux dans une assertion. */
const DEFAULT_CANDIDATE_DETAIL: OrganizationSearchResult = {
  id: 'org-candidat-1',
  name: 'Candidat Défaut SARL',
};

function makeDevis(overrides: Partial<Devis> = {}): Devis {
  return {
    id: 'devis-1',
    organization: LOT_RESULT.organization.id,
    candidate_organization: 'org-candidat-1',
    lot: LOT_RESULT.id,
    amount: '12500000.00',
    marge_estimee: '1500000.00',
    logged_by: 'admin-1',
    created_at: '2026-03-02T09:14:00Z',
    status: 'candidat',
    lot_detail: LOT_RESULT,
    candidate_organization_detail: DEFAULT_CANDIDATE_DETAIL,
    ...overrides,
  };
}

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    searchLots: vi.fn().mockResolvedValue([LOT_RESULT]),
    searchOrganizations: vi.fn().mockResolvedValue([CANDIDATE_ORG_RESULT]),
    ...overrides,
  });
  render(withApiClient(api, <DevisView />));
  return { api };
}

/** Le debounce réel (250ms, `DevisView.tsx::SEARCH_DEBOUNCE_MS`) tourne sur
 * de vrais timers ici — `findByRole`/`waitFor` de RTL pollent en temps réel
 * (timeout par défaut 1000ms, largement suffisant), jamais de fake timers :
 * combiner fake timers et le polling interne de RTL (qui utilise aussi
 * `setTimeout`) bloquerait sans avancer manuellement chaque tick interne. */
async function selectLot() {
  fireEvent.change(screen.getByLabelText('Rechercher un lot (nom)'), { target: { value: 'A12' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Lot A12 — Programme Verif F027 (Org Constructeur Verif)' }));
}

async function selectCandidateOrganization() {
  fireEvent.change(screen.getByLabelText('Rechercher une organisation candidate (nom)'), { target: { value: 'Bati' } });
  fireEvent.click(await screen.findByRole('button', { name: CANDIDATE_ORG_RESULT.name }));
}

describe('DevisView — recherche de lot en direct (ticket B-028/027)', () => {
  it('aucun appel avant la première frappe', () => {
    const searchLots = vi.fn();
    renderView({ searchLots });

    expect(searchLots).not.toHaveBeenCalled();
    expect(screen.queryByTestId('no-search-results')).not.toBeInTheDocument();
  });

  it('après la saisie, appelle searchLots(query) et affiche les résultats désambiguïsés par le programme', async () => {
    const searchLots = vi.fn().mockResolvedValue([LOT_RESULT]);
    renderView({ searchLots });

    fireEvent.change(screen.getByLabelText('Rechercher un lot (nom)'), { target: { value: 'A12' } });

    await waitFor(() => expect(searchLots).toHaveBeenCalledWith('A12'));
    expect(await screen.findByRole('button', { name: 'Lot A12 — Programme Verif F027 (Org Constructeur Verif)' })).toBeInTheDocument();
  });

  it('une recherche sans résultat affiche "Aucun résultat.", jamais une liste vide silencieuse', async () => {
    renderView({ searchLots: vi.fn().mockResolvedValue([]) });

    fireEvent.change(screen.getByLabelText('Rechercher un lot (nom)'), { target: { value: 'introuvable' } });

    expect(await screen.findByTestId('no-search-results')).toBeInTheDocument();
  });

  it('un échec réseau affiche une erreur explicite', async () => {
    renderView({ searchLots: vi.fn().mockRejectedValue(new Error('network down')) });

    fireEvent.change(screen.getByLabelText('Rechercher un lot (nom)'), { target: { value: 'A12' } });

    expect(await screen.findByText("Impossible d'effectuer la recherche.")).toBeInTheDocument();
  });

  it('sélectionner un résultat affiche le lot choisi et charge ses devis ; "Changer de lot" revient au sélecteur', async () => {
    const listDevisForLot = vi.fn().mockResolvedValue([]);
    renderView({ listDevisForLot });

    await selectLot();

    expect(screen.getByText('Lot A12', { selector: 'strong' })).toBeInTheDocument();
    await waitFor(() => expect(listDevisForLot).toHaveBeenCalledWith(LOT_RESULT.id, LOT_RESULT.organization.id));

    fireEvent.click(screen.getByRole('button', { name: 'Changer de lot' }));

    expect(screen.queryByText('Lot A12', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rechercher un lot (nom)')).toBeInTheDocument();
  });
});

describe('DevisView — liste des devis d\'un lot (ticket 022/027)', () => {
  it('une liste vide affiche "Aucun devis enregistré pour ce lot."', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([]) });

    await selectLot();

    expect(await screen.findByTestId('no-devis')).toBeInTheDocument();
  });

  it('affiche les champs réels (montant, saisi par, date, statut)', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis()]) });

    await selectLot();

    expect(await screen.findByText('12500000.00')).toBeInTheDocument();
    expect(screen.getByText('admin-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verrouiller' })).toBeInTheDocument();
  });

  it('un devis déjà verrouillé affiche "Verrouillé", jamais de bouton d\'action', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis({ status: 'devis_verrouille' })]) });

    await selectLot();

    expect(await screen.findByTestId('devis-status')).toHaveTextContent('Verrouillé');
    expect(screen.queryByRole('button', { name: 'Verrouiller' })).not.toBeInTheDocument();
  });
});

describe('DevisView — noms lisibles sur une ligne de devis (ticket F-029/B-029)', () => {
  it('affiche le nom du lot + le programme parent, jamais l\'UUID brut en texte', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis()]) });

    await selectLot();

    const lotCell = await screen.findByText(`${LOT_RESULT.name} — ${LOT_RESULT.program.name}`);
    expect(lotCell).toBeInTheDocument();
    expect(screen.queryByText(LOT_RESULT.id)).not.toBeInTheDocument();
  });

  it('affiche le nom de l\'organisation candidate, jamais l\'UUID brut en texte', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis()]) });

    await selectLot();

    expect(await screen.findByText(DEFAULT_CANDIDATE_DETAIL.name)).toBeInTheDocument();
    expect(screen.queryByText('org-candidat-1')).not.toBeInTheDocument();
  });

  it('les UUID du lot et de l\'organisation candidate restent accessibles via title et un attribut technique, pas juste masqués', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis()]) });

    await selectLot();

    const lotCell = await screen.findByText(`${LOT_RESULT.name} — ${LOT_RESULT.program.name}`);
    expect(lotCell).toHaveAttribute('title', LOT_RESULT.id);
    expect(lotCell).toHaveAttribute('data-lot-id', LOT_RESULT.id);

    const candidateCell = screen.getByText(DEFAULT_CANDIDATE_DETAIL.name);
    expect(candidateCell).toHaveAttribute('title', 'org-candidat-1');
    expect(candidateCell).toHaveAttribute('data-organization-id', 'org-candidat-1');
  });

  it('deux devis pour des organisations candidates différentes affichent chacun leur propre nom', async () => {
    renderView({
      listDevisForLot: vi.fn().mockResolvedValue([
        makeDevis({ id: 'devis-1' }),
        makeDevis({
          id: 'devis-2',
          candidate_organization: 'org-candidat-2',
          candidate_organization_detail: { id: 'org-candidat-2', name: 'Autre Candidat SARL' },
        }),
      ]),
    });

    await selectLot();

    expect(await screen.findByText(DEFAULT_CANDIDATE_DETAIL.name)).toBeInTheDocument();
    expect(screen.getByText('Autre Candidat SARL')).toBeInTheDocument();
  });
});

describe('DevisView — verrouillage (ticket 022/027)', () => {
  it('cliquer "Verrouiller" appelle lockDevis(devisId, organizationId), recharge la liste', async () => {
    const lockDevis = vi.fn().mockResolvedValue(makeDevis({ status: 'devis_verrouille' }));
    const listDevisForLot = vi.fn()
      .mockResolvedValueOnce([makeDevis()])
      .mockResolvedValueOnce([makeDevis({ status: 'devis_verrouille' })]);
    renderView({ listDevisForLot, lockDevis });

    await selectLot();
    fireEvent.click(await screen.findByRole('button', { name: 'Verrouiller' }));

    await waitFor(() => expect(lockDevis).toHaveBeenCalledWith('devis-1', LOT_RESULT.organization.id));
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

    await selectLot();

    const lockedElsewhereButton = await screen.findByRole('button', { name: 'Lot déjà verrouillé' });
    expect(lockedElsewhereButton).toBeDisabled();
  });

  it('un 409 (LotAlreadyLockedError) affiche le message backend exact via ApiError.detail', async () => {
    const lockDevis = vi.fn().mockRejectedValue(
      new ApiError(409, 'Échec', 'Un devis est déjà verrouillé pour ce lot — un seul devis verrouillé par lot.'),
    );
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([makeDevis()]), lockDevis });

    await selectLot();
    fireEvent.click(await screen.findByRole('button', { name: 'Verrouiller' }));

    expect(await screen.findByText('Un devis est déjà verrouillé pour ce lot — un seul devis verrouillé par lot.')).toBeInTheDocument();
  });
});

describe('DevisView — enregistrer une candidature reçue hors plateforme (ticket 022/027/B-028)', () => {
  it('le bouton "Enregistrer la candidature" reste désactivé tant qu\'aucune organisation candidate n\'est sélectionnée', async () => {
    renderView({ listDevisForLot: vi.fn().mockResolvedValue([]) });

    await selectLot();
    await screen.findByTestId('no-devis');

    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '9000000.00' } });

    expect(screen.getByRole('button', { name: 'Enregistrer la candidature' })).toBeDisabled();
  });

  it('recherche l\'organisation candidate en direct, puis soumettre appelle createDevis avec son id, recharge la liste', async () => {
    const createDevis = vi.fn().mockResolvedValue(makeDevis());
    const listDevisForLot = vi.fn().mockResolvedValue([]);
    renderView({ listDevisForLot, createDevis });

    await selectLot();
    await screen.findByTestId('no-devis');

    await selectCandidateOrganization();
    expect(screen.getByText(CANDIDATE_ORG_RESULT.name, { selector: 'strong' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '9000000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la candidature' }));

    await waitFor(() => expect(createDevis).toHaveBeenCalledWith({
      organization: LOT_RESULT.organization.id,
      lot: LOT_RESULT.id,
      candidate_organization: CANDIDATE_ORG_RESULT.id,
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

    await selectLot();
    await screen.findByTestId('no-devis');
    await selectCandidateOrganization();

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
      organization: LOT_RESULT.organization.id,
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

    await selectLot();
    await screen.findByText(DEFAULT_CANDIDATE_DETAIL.name);

    expect(screen.queryByText('Aucun ajustement enregistré pour l\'instant.')).not.toBeInTheDocument();
  });

  it('un devis verrouillé SANS ajustement affiche "encore Candidat" côté vue candidat', async () => {
    renderView({
      listDevisForLot: vi.fn().mockResolvedValue([makeDevis({ status: 'devis_verrouille' })]),
      listAjustements: vi.fn().mockResolvedValue([]),
    });

    await selectLot();

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

    await selectLot();

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

    await selectLot();
    await screen.findByText('Aucun ajustement enregistré pour l\'instant.');

    fireEvent.change(screen.getByLabelText('Écart'), { target: { value: '-200000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer un ajustement' }));

    await waitFor(() => expect(createAjustement).toHaveBeenCalledWith('devis-1', {
      organization: LOT_RESULT.organization.id,
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

    await selectLot();
    await screen.findByText('Aucun ajustement enregistré pour l\'instant.');

    fireEvent.change(screen.getByLabelText('Écart'), { target: { value: '5000000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer un ajustement' }));

    expect(await screen.findByText('Écart (5000000.00) au-delà de la marge disponible (1500000.00).')).toBeInTheDocument();
  });
});
