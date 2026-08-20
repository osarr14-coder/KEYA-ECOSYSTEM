import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import type { CurrentPricingRates, PricingConfig } from '../api/types';
import { createMockApiClient, withApiClient } from '../testUtils';
import { PricingView } from './PricingView';

const COUNTRY_PACK_ID = 'country-pack-senegal';

function makePricingConfig(overrides: Partial<PricingConfig> = {}): PricingConfig {
  return {
    id: 'pricing-1',
    country_pack: COUNTRY_PACK_ID,
    canal: 'canal_1_marge',
    rate: '12.00',
    created_by: 'admin-1',
    created_at: '2026-03-02T09:14:00Z',
    ...overrides,
  };
}

const EMPTY_CURRENT_RATES: CurrentPricingRates = { canal_1_marge: null, canal_2_commission: null };

function renderView(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const api = createMockApiClient({
    getCurrentPricingRates: vi.fn().mockResolvedValue(EMPTY_CURRENT_RATES),
    getPricingHistory: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
  render(withApiClient(api, <PricingView />));
  return { api };
}

async function selectCountry(countryPackId = COUNTRY_PACK_ID) {
  fireEvent.change(screen.getByLabelText('Pays (Country Pack UUID)'), { target: { value: countryPackId } });
  fireEvent.click(screen.getByRole('button', { name: 'Charger les tarifs de ce pays' }));
  await screen.findByText(countryPackId, { selector: 'strong' });
}

describe('PricingView — sélection manuelle du pays (ticket F-028, dépendance backend transmise)', () => {
  it('affiche l\'avertissement sur l\'absence de sélecteur, aucun appel avant soumission', () => {
    const getCurrentPricingRates = vi.fn();
    renderView({ getCurrentPricingRates });

    expect(screen.getByText('Aucun sélecteur de pays disponible')).toBeInTheDocument();
    expect(getCurrentPricingRates).not.toHaveBeenCalled();
  });

  it('le bouton "Charger les tarifs de ce pays" reste désactivé tant qu\'aucun UUID n\'est saisi', () => {
    renderView();

    expect(screen.getByRole('button', { name: 'Charger les tarifs de ce pays' })).toBeDisabled();
  });

  it('soumettre le formulaire appelle getCurrentPricingRates et getPricingHistory (pour chaque canal) avec le pays saisi', async () => {
    const getCurrentPricingRates = vi.fn().mockResolvedValue(EMPTY_CURRENT_RATES);
    const getPricingHistory = vi.fn().mockResolvedValue([]);
    renderView({ getCurrentPricingRates, getPricingHistory });

    await selectCountry();

    await waitFor(() => expect(getCurrentPricingRates).toHaveBeenCalledWith(COUNTRY_PACK_ID));
    expect(getPricingHistory).toHaveBeenCalledWith(COUNTRY_PACK_ID, 'canal_1_marge');
    expect(getPricingHistory).toHaveBeenCalledWith(COUNTRY_PACK_ID, 'canal_2_commission');
  });

  it('"Changer de pays" revient au sélecteur', async () => {
    renderView();

    await selectCountry();
    fireEvent.click(screen.getByRole('button', { name: 'Changer de pays' }));

    expect(screen.queryByText(COUNTRY_PACK_ID, { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pays (Country Pack UUID)')).toBeInTheDocument();
  });
});

describe('PricingView — taux actuels (ticket 025-backend/F-028)', () => {
  it('un canal sans taux configuré affiche "Aucun taux configuré."', async () => {
    renderView({ getCurrentPricingRates: vi.fn().mockResolvedValue(EMPTY_CURRENT_RATES) });

    await selectCountry();

    const canal1 = await screen.findByTestId('current-rate-canal_1_marge');
    expect(canal1).toHaveTextContent('Marge (canal 1) : Aucun taux configuré.');
    const canal2 = screen.getByTestId('current-rate-canal_2_commission');
    expect(canal2).toHaveTextContent('Commission (canal 2) : Aucun taux configuré.');
  });

  it('un canal avec un taux configuré affiche le taux, qui l\'a saisi et quand', async () => {
    renderView({
      getCurrentPricingRates: vi.fn().mockResolvedValue({
        canal_1_marge: makePricingConfig({ rate: '12.00', created_by: 'admin-verif@example.com', created_at: '2026-03-02T09:14:00Z' }),
        canal_2_commission: null,
      }),
    });

    await selectCountry();

    const canal1 = await screen.findByTestId('current-rate-canal_1_marge');
    expect(canal1).toHaveTextContent('12.00 % — saisi par admin-verif@example.com le 2026-03-02T09:14:00Z');
  });

  it('un échec réseau affiche une erreur explicite', async () => {
    renderView({ getCurrentPricingRates: vi.fn().mockRejectedValue(new Error('network down')) });

    await selectCountry();

    expect(await screen.findByText('Impossible de charger les taux actuels.')).toBeInTheDocument();
  });
});

describe('PricingView — historique par canal (ticket 025-backend/F-028)', () => {
  it('un canal sans historique affiche "Aucun taux enregistré pour l\'instant."', async () => {
    renderView({ getPricingHistory: vi.fn().mockResolvedValue([]) });

    await selectCountry();

    expect(await screen.findByTestId('no-history-canal_1_marge')).toBeInTheDocument();
    expect(screen.getByTestId('no-history-canal_2_commission')).toBeInTheDocument();
  });

  it('affiche chaque ligne avec l\'ancien taux (ligne précédente) et le nouveau taux, provenance incluse', async () => {
    const getPricingHistory = vi.fn().mockImplementation((_countryPackId: string, canal: string) => {
      if (canal !== 'canal_1_marge') return Promise.resolve([]);
      return Promise.resolve([
        makePricingConfig({ id: 'p1', rate: '10.00', created_by: 'admin-1', created_at: '2026-01-01T00:00:00Z' }),
        makePricingConfig({ id: 'p2', rate: '12.00', created_by: 'admin-2', created_at: '2026-03-02T09:14:00Z' }),
      ]);
    });
    renderView({ getPricingHistory });

    await selectCountry();
    await screen.findByText('Marge (canal 1)', { selector: 'h4' });

    const rows = screen.getAllByRole('row');
    // ligne 0 = en-têtes, ligne 1 = première entrée (pas d'ancien taux), ligne 2 = seconde (ancien = 10.00 %)
    expect(rows[1]).toHaveTextContent('—10.00 %admin-1');
    expect(rows[2]).toHaveTextContent('10.00 %12.00 %admin-2');
  });
});

describe('PricingView — créer un nouveau taux (ticket 025-backend/F-028)', () => {
  it('soumettre le formulaire appelle createPricingConfig({country_pack, canal, rate}), recharge taux actuels et historique', async () => {
    const createPricingConfig = vi.fn().mockResolvedValue(makePricingConfig());
    const getCurrentPricingRates = vi.fn().mockResolvedValue(EMPTY_CURRENT_RATES);
    renderView({ createPricingConfig, getCurrentPricingRates });

    await selectCountry();
    await waitFor(() => expect(getCurrentPricingRates).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Canal'), { target: { value: 'canal_2_commission' } });
    fireEvent.change(screen.getByLabelText('Taux (%)'), { target: { value: '5.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer ce taux' }));

    await waitFor(() => expect(createPricingConfig).toHaveBeenCalledWith({
      country_pack: COUNTRY_PACK_ID,
      canal: 'canal_2_commission',
      rate: '5.50',
    }));
    await waitFor(() => expect(getCurrentPricingRates).toHaveBeenCalledTimes(2));
  });

  it('un échec avec erreurs de validation DRF ({champ: [messages]}) affiche les messages backend exacts', async () => {
    const createPricingConfig = vi.fn().mockRejectedValue(
      new ApiError(400, 'Échec', undefined, { country_pack: ['Country Pack introuvable.'] }),
    );
    renderView({ createPricingConfig });

    await selectCountry();
    fireEvent.change(screen.getByLabelText('Taux (%)'), { target: { value: '12.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer ce taux' }));

    expect(await screen.findByText('Country Pack introuvable.')).toBeInTheDocument();
  });

  it('plusieurs messages d\'erreur DRF sont tous affichés, joints', async () => {
    const createPricingConfig = vi.fn().mockRejectedValue(
      new ApiError(400, 'Échec', undefined, {
        rate: ['Assurez-vous que ce champ comporte au plus 5 chiffres au total.'],
        canal: ['Ce champ est requis.'],
      }),
    );
    renderView({ createPricingConfig });

    await selectCountry();
    fireEvent.change(screen.getByLabelText('Taux (%)'), { target: { value: '999999.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer ce taux' }));

    expect(await screen.findByText(
      'Assurez-vous que ce champ comporte au plus 5 chiffres au total. Ce champ est requis.',
    )).toBeInTheDocument();
  });

  it('un échec réseau générique (corps non exploitable) affiche un message de repli', async () => {
    renderView({ createPricingConfig: vi.fn().mockRejectedValue(new Error('network down')) });

    await selectCountry();
    fireEvent.change(screen.getByLabelText('Taux (%)'), { target: { value: '12.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer ce taux' }));

    expect(await screen.findByText('Échec de la création du taux.')).toBeInTheDocument();
  });
});
