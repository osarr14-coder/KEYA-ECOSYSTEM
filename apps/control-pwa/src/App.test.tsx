import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { clearIndexedDB } from './testUtils/clearIndexedDB';
import { seedFixtureMissions } from './testUtils/missionFixtures';

beforeEach(async () => {
  await clearIndexedDB();
  // Ticket 012 : la liste de missions vient désormais du cache local
  // (jamais `MOCK_MISSIONS`, retiré) — peuplé ici pour que « Lot 12 » reste
  // cliquable dans ces scénarios, comme avant.
  await seedFixtureMissions();
});

function setOffline() {
  Object.defineProperty(window.navigator, 'onLine', { value: false, writable: true, configurable: true });
  window.dispatchEvent(new Event('offline'));
}

describe(
  'Ticket 010 (passe 1) — critère d\'acceptation central : une inspection saisie en mode ' +
  'avion complet, avec photos, survit à une fermeture totale de l\'application avant réouverture',
  () => {
    it('checklist, photos, commentaire, décision et horodatage device sont intégralement retrouvés au redémarrage', async () => {
      // Mode avion complet : `navigator.onLine` à `false` dès avant la
      // première saisie, ET aucun appel réseau ne doit être tenté à AUCUN
      // moment de tout le scénario (assertion finale sur le spy).
      setOffline();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // --- Session 1 : l'inspecteur saisit son inspection hors ligne ---
      const firstSession = render(<App />);

      expect(await screen.findByText('Hors ligne')).toBeInTheDocument();

      fireEvent.click(await screen.findByText('Lot 12'));
      await screen.findByRole('heading', { name: 'Lot 12 — Résidence Ker' });

      // Chaque interaction est attendue jusqu'à sa persistance réelle avant
      // la suivante — un inspecteur réel ne tape jamais deux champs au
      // même instant précis, et surtout : ça prouve que CHAQUE saisie
      // individuelle est bien écrite, pas seulement l'état final agrégé.
      const { getDraftForMission } = await import('./db/repository');

      fireEvent.click(screen.getByLabelText('Sécurité du chantier'));
      await waitFor(async () => {
        const draft = await getDraftForMission('mission-1');
        expect(draft?.checklist.find((item) => item.id === 'securite')?.checked).toBe(true);
      });

      fireEvent.click(screen.getByLabelText('Conformité aux plans'));
      await waitFor(async () => {
        const draft = await getDraftForMission('mission-1');
        expect(draft?.checklist.find((item) => item.id === 'conformite_plans')?.checked).toBe(true);
      });

      const commentaire = screen.getByLabelText('Commentaire');
      fireEvent.change(commentaire, { target: { value: 'Fissure visible sur le mur nord, à surveiller.' } });
      fireEvent.blur(commentaire);
      await waitFor(async () => {
        const draft = await getDraftForMission('mission-1');
        expect(draft?.comment).toBe('Fissure visible sur le mur nord, à surveiller.');
      });

      const photo1 = new File(['photo-1-binaire'], 'facade.jpg', { type: 'image/jpeg' });
      const photo2 = new File(['photo-2-binaire'], 'fissure.jpg', { type: 'image/jpeg' });
      fireEvent.change(screen.getByLabelText('Ajouter une photo'), { target: { files: [photo1, photo2] } });
      await screen.findByText('fissure.jpg');
      await waitFor(async () => {
        const draft = await getDraftForMission('mission-1');
        expect(draft?.photos).toHaveLength(2);
      });

      fireEvent.click(screen.getByLabelText('Réserve'));

      // Attendre que la dernière saisie (la décision) soit bien écrite
      // avant de "fermer" l'application — un inspecteur réel verrait la
      // même confirmation visuelle (le statut synchro affiché) avant de
      // quitter l'app.
      await waitFor(async () => {
        const draft = await getDraftForMission('mission-1');
        expect(draft?.decision).toBe('reserve');
      });
      await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveAttribute('data-status', 'pending'));

      // Horodatage device tel qu'écrit AVANT la fermeture — capturé
      // directement en base (pas depuis l'état React, qu'on va détruire) :
      // c'est la valeur de référence à laquelle comparer après réouverture.
      const draftBeforeClosing = await getDraftForMission('mission-1');
      expect(draftBeforeClosing?.deviceTimestamp).toBeTruthy();

      // --- "Fermeture complète de l'application" ---
      // `unmount()` détruit tout l'arbre React et son état mémoire — plus
      // aucune référence JS aux valeurs saisies ne survit après cet appel,
      // exactement comme un processus d'application tué par l'OS. Seul ce
      // qui a été écrit dans IndexedDB (persistant, sur disque) peut
      // survivre à partir d'ici.
      firstSession.unmount();

      // --- Session 2 : réouverture de l'application ---
      render(<App />);
      fireEvent.click(await screen.findByText('Lot 12'));
      await screen.findByRole('heading', { name: 'Lot 12 — Résidence Ker' });

      // Rien n'a été perdu : checklist...
      expect(screen.getByLabelText('Sécurité du chantier')).toBeChecked();
      expect(screen.getByLabelText('Conformité aux plans')).toBeChecked();
      expect(screen.getByLabelText('Qualité des matériaux')).not.toBeChecked();
      // ...commentaire...
      expect(screen.getByLabelText('Commentaire')).toHaveValue(
        'Fissure visible sur le mur nord, à surveiller.',
      );
      // ...photos (les deux, dans leur ordre de saisie)...
      expect(screen.getByText('facade.jpg')).toBeInTheDocument();
      expect(screen.getByText('fissure.jpg')).toBeInTheDocument();
      // ...décision...
      expect(screen.getByLabelText('Réserve')).toBeChecked();
      expect(screen.getByLabelText('Conforme')).not.toBeChecked();
      // ...statut de synchronisation toujours "pending" (aucune logique de
      // synchronisation n'existe cette passe — comportement attendu).
      expect(screen.getByTestId('sync-status')).toHaveAttribute('data-status', 'pending');

      // Horodatage device : survit EXACTEMENT tel qu'écrit avant la
      // fermeture — rouvrir l'app ne doit jamais réécrire silencieusement
      // l'horodatage d'une saisie déjà faite (pas de "now" au chargement).
      // Comparé en base directement, pas seulement via l'UI, pour prouver
      // la persistance réelle plutôt qu'un état React qui aurait survécu
      // par accident.
      const draftAfterReopening = await getDraftForMission('mission-1');
      expect(draftAfterReopening?.deviceTimestamp).toBe(draftBeforeClosing?.deviceTimestamp);

      // Mode avion complet, de bout en bout : jamais un seul appel réseau.
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  },
);

describe('App — passe 2 : la synchronisation démarre au retour du réseau, jamais avant', () => {
  it('un item saisi hors ligne déclenche un appel réseau réel dès le passage en ligne, et se synchronise', async () => {
    setOffline();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        status: 'applied',
        inspection: { id: 'insp-x', created_at: '2026-08-15T10:00:00.000Z', client_correlation_id: 'whatever' },
      }),
    } as Response);

    render(<App />);
    fireEvent.click(await screen.findByText('Lot 12'));
    await screen.findByRole('heading', { name: 'Lot 12 — Résidence Ker' });
    fireEvent.click(await screen.findByLabelText('Réserve'));

    const { getDraftForMission } = await import('./db/repository');
    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.decision).toBe('reserve');
    });

    // Toujours rien tant qu'on reste hors ligne — même garantie que la
    // passe 1, jusqu'à cet instant précis.
    expect(fetchSpy).not.toHaveBeenCalled();

    // --- Retour du réseau ---
    Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true, configurable: true });
    // `act(...)` : `useOnlineStatus` (App.tsx) met à jour un état React de
    // manière synchrone en réaction à cet événement — sans cet englobage,
    // React avertit d'une mise à jour hors `act()` (le dispatch n'est ici
    // pas déclenché via `fireEvent`, qui l'englobe automatiquement).
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.syncStatus).toBe('synced');
      expect(draft?.serverTimestamp).toBe('2026-08-15T10:00:00.000Z');
    });
  });
});

describe('App — interface tactile 360-430px', () => {
  it('contraint la largeur du contenu entre 360 et 430px', async () => {
    render(<App />);
    await screen.findByText('Mes missions');
    const container = screen.getByText('Mes missions').closest('div');
    expect(container).toHaveStyle({ maxWidth: '430px', minWidth: '360px' });
  });
});
