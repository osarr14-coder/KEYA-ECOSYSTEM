import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DevisAppelOffreMockup } from './DevisAppelOffreMockup';

describe(
  'DevisAppelOffreMockup — maquette visuelle uniquement (ticket 025), aucun appel réseau',
  () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("ne déclenche AUCUN appel réseau au rendu, même après interaction", () => {
      render(<DevisAppelOffreMockup />);

      fireEvent.click(screen.getByRole('button', { name: 'Voir le détail de ce qui reste à câbler' }));
      for (const button of screen.getAllByRole('button', { name: /Verrouiller|Saisir un devis/ })) {
        fireEvent.click(button);
      }

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('affiche un bandeau explicite indiquant que les données sont statiques', () => {
      render(<DevisAppelOffreMockup />);
      expect(screen.getByText('Maquette visuelle — aucune donnée réelle')).toBeInTheDocument();
    });

    it('affiche les devis mockés (organisation candidate, montant, statut)', () => {
      render(<DevisAppelOffreMockup />);

      expect(screen.getAllByText('Bâti Sénégal SARL').length).toBeGreaterThan(0);
      expect(screen.getByText('12 500 000 FCFA')).toBeInTheDocument();
    });

    it(
      "n'affiche JAMAIS de statut « gagnant » — le comportement dépend du ticket 024, "
      + 'non fusionné au moment de cette maquette',
      () => {
        render(<DevisAppelOffreMockup />);

        expect(screen.queryByText(/gagnant$/i)).not.toBeInTheDocument();
        // Seul le titre de la section "à câbler" mentionne le mot, jamais
        // comme un statut affiché sur une ligne de devis.
        const statusBadges = screen.getAllByTestId('devis-status');
        for (const badge of statusBadges) {
          expect(badge.textContent).toMatch(/^(Candidat|Verrouillé)$/);
        }
      },
    );

    it('marque clairement la section réconciliation comme "à câbler" (ticket 024)', () => {
      render(<DevisAppelOffreMockup />);
      expect(screen.getByText(/à câbler une fois le ticket 024 fusionné/i)).toBeInTheDocument();
    });

    it('le détail "à câbler" est replié par défaut, dépliable au clic', () => {
      render(<DevisAppelOffreMockup />);

      expect(screen.queryByText(/Séquencement du statut/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Voir le détail de ce qui reste à câbler' }));

      expect(screen.getByText(/Séquencement du statut/i)).toBeInTheDocument();
    });

    it('toutes les actions (verrouiller, saisir un devis) sont désactivées', () => {
      render(<DevisAppelOffreMockup />);

      const actionButtons = screen.getAllByRole('button', { name: /Verrouiller|Saisir un devis|Lot déjà verrouillé/ });
      expect(actionButtons.length).toBeGreaterThan(0);
      for (const button of actionButtons) {
        expect(button).toBeDisabled();
      }
    });

    it('un devis déjà verrouillé affiche "Verrouillé" comme statut ET comme action désactivée', () => {
      render(<DevisAppelOffreMockup />);

      const lockedRowButton = screen.getByRole('button', { name: 'Verrouillé' });
      expect(lockedRowButton).toBeDisabled();
    });
  },
);
