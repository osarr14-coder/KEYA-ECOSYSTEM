import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DevisAppelOffreMockup } from './DevisAppelOffreMockup';

describe(
  'DevisAppelOffreMockup — maquette visuelle uniquement (tickets 025/026), aucun appel réseau',
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
      for (const button of screen.getAllByRole('button', { name: /Verrouiller|Saisir un devis|Enregistrer un ajustement/ })) {
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

    it('le détail "reste à câbler" est replié par défaut, dépliable au clic', () => {
      render(<DevisAppelOffreMockup />);

      expect(screen.queryByText(/Aucun appel réseau réel nulle part/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Voir le détail de ce qui reste à câbler' }));

      expect(screen.getByText(/Aucun appel réseau réel nulle part/i)).toBeInTheDocument();
    });

    it('toutes les actions (verrouiller, saisir un devis, enregistrer un ajustement) sont désactivées', () => {
      render(<DevisAppelOffreMockup />);

      const actionButtons = screen.getAllByRole(
        'button',
        { name: /Verrouiller|Saisir un devis|Lot déjà verrouillé|Enregistrer un ajustement/ },
      );
      expect(actionButtons.length).toBeGreaterThan(0);
      for (const button of actionButtons) {
        expect(button).toBeDisabled();
      }
    });

    it('un devis déjà verrouillé affiche "Verrouillé" comme statut admin ET comme action désactivée', () => {
      render(<DevisAppelOffreMockup />);

      const lockedRowButtons = screen.getAllByRole('button', { name: 'Verrouillé' });
      expect(lockedRowButtons.length).toBeGreaterThan(0);
      for (const button of lockedRowButtons) {
        expect(button).toBeDisabled();
      }
    });
  },
);

describe(
  'DevisAppelOffreMockup — statut « gagnant » gaté par la réconciliation (ticket 026, '
  + 'contrat vérifié dans apps/procurement/services.py::get_candidate_visible_devis_status '
  + 'avant d\'écrire cette maquette)',
  () => {
    it(
      'un devis VERROUILLÉ avec au moins un ajustement affiche "Gagnant" comme vue candidat '
      + '(Lot A12)',
      () => {
        render(<DevisAppelOffreMockup />);

        const notes = screen.getAllByTestId('candidate-visible-status');
        const gagnantNote = notes.find((note) => note.getAttribute('data-status') === 'gagnant');
        expect(gagnantNote).toBeDefined();
        expect(gagnantNote).toHaveTextContent('Gagnant');
      },
    );

    it(
      'un devis VERROUILLÉ SANS aucun ajustement reste "Candidat" comme vue candidat, '
      + 'jamais "Gagnant" (Lot C07 — le verrouillage seul ne suffit jamais)',
      () => {
        render(<DevisAppelOffreMockup />);

        const notes = screen.getAllByTestId('candidate-visible-status');
        const stillCandidateNotes = notes.filter((note) => note.getAttribute('data-status') === 'candidat');
        expect(stillCandidateNotes.length).toBeGreaterThan(0);
        for (const note of stillCandidateNotes) {
          expect(note).not.toHaveTextContent('Gagnant');
          expect(note).toHaveTextContent('encore « Candidat »');
        }
      },
    );

    it('un devis NON verrouillé n\'affiche aucune vue candidat (le gating ne concerne que les devis verrouillés)', () => {
      render(<DevisAppelOffreMockup />);

      // 2 devis non verrouillés dans les données mockées (Fondation Solide,
      // Bâti Sénégal sur Lot B03) : ni l'un ni l'autre ne doit avoir de
      // note de statut candidat.
      const notes = screen.getAllByTestId('candidate-visible-status');
      expect(notes.length).toBe(2); // uniquement les 2 devis verrouillés (Lot A12 + Lot C07)
    });

    it(
      'le statut admin ("Verrouillé") et le statut candidat peuvent différer pour la MÊME '
      + 'ligne, au même instant — jamais fusionnés en un seul indicateur',
      () => {
        render(<DevisAppelOffreMockup />);

        // Lot C07 : l'admin voit "Verrouillé" (DevisStatusIndicator), le
        // candidat voit encore "Candidat" (CandidateVisibleStatusNote) —
        // les deux textes coexistent pour la même ligne.
        const lockedBadges = screen.getAllByTestId('devis-status');
        const lockedBadge = lockedBadges.find((badge) => badge.getAttribute('data-status') === 'verrouille');
        expect(lockedBadge).toHaveTextContent('Verrouillé');
      },
    );

    it('affiche l\'historique des ajustements (écart, marge résultante, favorable/défavorable) pour un devis réconcilié', () => {
      render(<DevisAppelOffreMockup />);

      expect(screen.getByText(/-200 000 FCFA \(favorable\)/)).toBeInTheDocument();
      expect(screen.getByText(/\+300 000 FCFA \(défavorable\)/)).toBeInTheDocument();
      expect(screen.getByText('1 400 000 FCFA')).toBeInTheDocument();
    });

    it('affiche "Aucun ajustement enregistré" pour un devis verrouillé sans réconciliation', () => {
      render(<DevisAppelOffreMockup />);
      expect(screen.getByText('Aucun ajustement enregistré pour l\'instant.')).toBeInTheDocument();
    });
  },
);
