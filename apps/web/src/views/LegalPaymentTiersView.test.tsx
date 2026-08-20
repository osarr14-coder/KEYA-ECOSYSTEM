import {
  fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { LegalPaymentTierTemplate } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { LegalPaymentTiersView } from './LegalPaymentTiersView';

const COUNTRY_PACK_ID = 'country-pack-senegal';

function makeTemplate(overrides: Partial<LegalPaymentTierTemplate> = {}): LegalPaymentTierTemplate {
  return {
    id: 'template-1',
    country_pack: COUNTRY_PACK_ID,
    version: 1,
    created_by: 'admin-1',
    created_at: '2026-03-02T09:14:00Z',
    activated_by: null,
    activated_at: null,
    steps: [
      {
        id: 'step-1', order: 1, code: 'FOND', label: 'Fondations', cumulative_cap_percent: '40.00', allows_progressive_payments: false,
      },
      {
        id: 'step-2', order: 2, code: 'LIVR', label: 'Livraison', cumulative_cap_percent: '100.00', allows_progressive_payments: true,
      },
    ],
    ...overrides,
  };
}

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getActiveLegalPaymentTierTemplate: vi.fn().mockResolvedValue(null),
    getLegalPaymentTierTemplateHistory: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
  render(withApiClient(api, <LegalPaymentTiersView />));
  return { api };
}

async function selectCountry(countryPackId = COUNTRY_PACK_ID) {
  fireEvent.change(screen.getByLabelText('Pays (Country Pack UUID)'), { target: { value: countryPackId } });
  fireEvent.click(screen.getByRole('button', { name: 'Charger les paliers de ce pays' }));
  await screen.findByText(countryPackId, { selector: 'strong' });
}

describe('LegalPaymentTiersView — sélection manuelle du pays (ticket F-030, dépendance backend transmise)', () => {
  it('affiche l\'avertissement sur l\'absence de sélecteur, aucun appel avant soumission', () => {
    const getActiveLegalPaymentTierTemplate = vi.fn();
    renderView({ getActiveLegalPaymentTierTemplate });

    expect(screen.getByText('Aucun sélecteur de pays disponible')).toBeInTheDocument();
    expect(getActiveLegalPaymentTierTemplate).not.toHaveBeenCalled();
  });

  it('soumettre le formulaire appelle getActiveLegalPaymentTierTemplate et getLegalPaymentTierTemplateHistory avec le pays saisi', async () => {
    const getActiveLegalPaymentTierTemplate = vi.fn().mockResolvedValue(null);
    const getLegalPaymentTierTemplateHistory = vi.fn().mockResolvedValue([]);
    renderView({ getActiveLegalPaymentTierTemplate, getLegalPaymentTierTemplateHistory });

    await selectCountry();

    await waitFor(() => expect(getActiveLegalPaymentTierTemplate).toHaveBeenCalledWith(COUNTRY_PACK_ID));
    expect(getLegalPaymentTierTemplateHistory).toHaveBeenCalledWith(COUNTRY_PACK_ID);
  });

  it('"Changer de pays" revient au sélecteur', async () => {
    renderView();

    await selectCountry();
    fireEvent.click(screen.getByRole('button', { name: 'Changer de pays' }));

    expect(screen.queryByText(COUNTRY_PACK_ID, { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pays (Country Pack UUID)')).toBeInTheDocument();
  });
});

describe('LegalPaymentTiersView — template actif (ticket B-027/F-030)', () => {
  it('aucun template actif affiche "Aucun template actif pour ce pays."', async () => {
    renderView({ getActiveLegalPaymentTierTemplate: vi.fn().mockResolvedValue(null) });

    await selectCountry();

    expect(await screen.findByTestId('no-active-template')).toBeInTheDocument();
  });

  it('un template actif affiche sa version, provenance, et ses paliers triés tels que renvoyés par le backend', async () => {
    renderView({
      getActiveLegalPaymentTierTemplate: vi.fn().mockResolvedValue(makeTemplate({
        activated_by: 'admin-2', activated_at: '2026-04-01T10:00:00Z',
      })),
    });

    await selectCountry();

    const panel = await screen.findByTestId('active-template');
    expect(panel).toHaveTextContent('Version 1 — activé par admin-2 le 2026-04-01T10:00:00Z');
    expect(screen.getByText('FOND')).toBeInTheDocument();
    expect(screen.getByText('Fondations')).toBeInTheDocument();
    expect(screen.getByText('40.00 %')).toBeInTheDocument();
    expect(screen.getByText('LIVR')).toBeInTheDocument();
  });

  it('un échec réseau affiche une erreur explicite', async () => {
    renderView({ getActiveLegalPaymentTierTemplate: vi.fn().mockRejectedValue(new Error('network down')) });

    await selectCountry();

    expect(await screen.findByText('Impossible de charger le template actif.')).toBeInTheDocument();
  });
});

describe('LegalPaymentTiersView — historique (ticket B-027/F-030)', () => {
  it('aucun template enregistré affiche "Aucun template enregistré pour l\'instant."', async () => {
    renderView({ getLegalPaymentTierTemplateHistory: vi.fn().mockResolvedValue([]) });

    await selectCountry();

    expect(await screen.findByTestId('no-template-history')).toBeInTheDocument();
  });

  it('un brouillon jamais activé affiche "—" pour activé par/le, jamais null en texte', async () => {
    renderView({
      getLegalPaymentTierTemplateHistory: vi.fn().mockResolvedValue([makeTemplate({ activated_by: null, activated_at: null })]),
    });

    await selectCountry();

    const history = within(await screen.findByRole('region', { name: 'Historique des templates' }));
    const rows = history.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('1admin-12026-03-02T09:14:00Z——');
  });

  it('le template actuellement actif affiche "Actif", jamais un bouton "Activer"', async () => {
    const active = makeTemplate({ id: 'template-active', activated_by: 'admin-2', activated_at: '2026-04-01T10:00:00Z' });
    renderView({
      getActiveLegalPaymentTierTemplate: vi.fn().mockResolvedValue(active),
      getLegalPaymentTierTemplateHistory: vi.fn().mockResolvedValue([active]),
    });

    await selectCountry();

    expect(await screen.findByTestId('template-active-badge')).toHaveTextContent('Actif');
    expect(screen.queryByRole('button', { name: 'Activer' })).not.toBeInTheDocument();
  });

  it('un template déjà activé mais SUPPLANTÉ par un actif plus récent garde son "activé par/le" ET propose "Activer" (pas "Actif")', async () => {
    const superseded = makeTemplate({
      id: 'template-old', version: 1, activated_by: 'admin-1', activated_at: '2026-01-01T00:00:00Z',
    });
    const current = makeTemplate({
      id: 'template-new', version: 2, activated_by: 'admin-2', activated_at: '2026-04-01T10:00:00Z',
    });
    renderView({
      getActiveLegalPaymentTierTemplate: vi.fn().mockResolvedValue(current),
      getLegalPaymentTierTemplateHistory: vi.fn().mockResolvedValue([superseded, current]),
    });

    await selectCountry();

    const history = within(await screen.findByRole('region', { name: 'Historique des templates' }));
    const rows = history.getAllByRole('row');
    // version 1 (superseded) : garde admin-1/2026-01-01, propose "Activer"
    expect(rows[1]).toHaveTextContent('admin-1');
    expect(rows[1]).toHaveTextContent('2026-01-01T00:00:00Z');
    // version 2 (actif courant) : badge "Actif"
    expect(rows[2]).toHaveTextContent('Actif');
    expect(history.getByRole('button', { name: 'Activer' })).toBeInTheDocument();
  });

  it('cliquer "Activer" appelle activateLegalPaymentTierTemplate(templateId), recharge actif + historique', async () => {
    const draft = makeTemplate({ id: 'template-draft' });
    const activateLegalPaymentTierTemplate = vi.fn().mockResolvedValue({ ...draft, activated_by: 'admin-9', activated_at: '2026-05-01T00:00:00Z' });
    const getActiveLegalPaymentTierTemplate = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...draft, activated_by: 'admin-9', activated_at: '2026-05-01T00:00:00Z' });
    renderView({
      getActiveLegalPaymentTierTemplate,
      getLegalPaymentTierTemplateHistory: vi.fn().mockResolvedValue([draft]),
      activateLegalPaymentTierTemplate,
    });

    await selectCountry();
    fireEvent.click(await screen.findByRole('button', { name: 'Activer' }));

    await waitFor(() => expect(activateLegalPaymentTierTemplate).toHaveBeenCalledWith('template-draft'));
    expect(await screen.findByTestId('template-active-badge')).toBeInTheDocument();
    expect(getActiveLegalPaymentTierTemplate).toHaveBeenCalledTimes(2);
  });

  it('un 400 (template introuvable) affiche le message backend exact', async () => {
    const activateLegalPaymentTierTemplate = vi.fn().mockRejectedValue(
      new ApiError(400, 'Échec', undefined, { template: ['LegalPaymentTierTemplate introuvable.'] }),
    );
    renderView({
      getLegalPaymentTierTemplateHistory: vi.fn().mockResolvedValue([makeTemplate()]),
      activateLegalPaymentTierTemplate,
    });

    await selectCountry();
    fireEvent.click(await screen.findByRole('button', { name: 'Activer' }));

    expect(await screen.findByText('LegalPaymentTierTemplate introuvable.')).toBeInTheDocument();
  });
});

describe('LegalPaymentTiersView — créer un nouveau template (ticket B-027/F-030)', () => {
  it('un seul palier par défaut, "Retirer" désactivé tant qu\'il n\'en reste qu\'un', async () => {
    renderView();

    await selectCountry();

    expect(screen.getByRole('button', { name: 'Retirer' })).toBeDisabled();
  });

  it('"Ajouter un palier" ajoute une ligne, "Retirer" devient possible', async () => {
    renderView();

    await selectCountry();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un palier' }));

    const removeButtons = screen.getAllByRole('button', { name: 'Retirer' });
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[0]).not.toBeDisabled();

    fireEvent.click(removeButtons[0]);
    expect(screen.getAllByRole('button', { name: 'Retirer' })).toHaveLength(1);
  });

  it('soumettre appelle createLegalPaymentTierTemplate avec version + paliers construits depuis le formulaire, recharge actif et historique', async () => {
    const createLegalPaymentTierTemplate = vi.fn().mockResolvedValue(makeTemplate());
    const getActiveLegalPaymentTierTemplate = vi.fn().mockResolvedValue(null);
    const getLegalPaymentTierTemplateHistory = vi.fn().mockResolvedValue([]);
    renderView({ createLegalPaymentTierTemplate, getActiveLegalPaymentTierTemplate, getLegalPaymentTierTemplateHistory });

    await selectCountry();
    await waitFor(() => expect(getActiveLegalPaymentTierTemplate).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Ordre du palier 1'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Code du palier 1'), { target: { value: 'FOND' } });
    fireEvent.change(screen.getByLabelText('Libellé du palier 1'), { target: { value: 'Fondations' } });
    fireEvent.change(screen.getByLabelText('Plafond cumulé du palier 1'), { target: { value: '100.00' } });
    fireEvent.click(screen.getByLabelText('Paiements progressifs du palier 1'));

    fireEvent.click(screen.getByRole('button', { name: 'Créer ce template' }));

    await waitFor(() => expect(createLegalPaymentTierTemplate).toHaveBeenCalledWith({
      country_pack: COUNTRY_PACK_ID,
      version: 1,
      steps: [
        {
          order: 1, code: 'FOND', label: 'Fondations', cumulative_cap_percent: '100.00', allows_progressive_payments: true,
        },
      ],
    }));
    await waitFor(() => expect(getActiveLegalPaymentTierTemplate).toHaveBeenCalledTimes(2));
  });

  it('un 400 (plafonds non strictement croissants) affiche le message backend exact', async () => {
    const createLegalPaymentTierTemplate = vi.fn().mockRejectedValue(
      new ApiError(400, 'Échec', undefined, {
        steps: ['Les plafonds cumulés doivent être strictement croissants — le palier « FOND » (40.00%) n\'est pas supérieur au précédent.'],
      }),
    );
    renderView({ createLegalPaymentTierTemplate });

    await selectCountry();
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Code du palier 1'), { target: { value: 'FOND' } });
    fireEvent.change(screen.getByLabelText('Plafond cumulé du palier 1'), { target: { value: '40.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer ce template' }));

    expect(await screen.findByText(
      'Les plafonds cumulés doivent être strictement croissants — le palier « FOND » (40.00%) n\'est pas supérieur au précédent.',
    )).toBeInTheDocument();
  });
});
