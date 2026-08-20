import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type TabRoute } from './tabRouting';
import { useUrlSyncedTab } from './useUrlSyncedTab';

type TabId = 'a' | 'b' | 'c';

const ROUTES: TabRoute<TabId>[] = [
  { id: 'a', path: '/' },
  { id: 'b', path: '/b' },
  { id: 'c', path: '/c' },
];

function TestHarness() {
  const [activeTabId, navigate] = useUrlSyncedTab(ROUTES, 'a');
  return (
    <div>
      <p>Onglet actif : {activeTabId}</p>
      <button type="button" onClick={() => navigate('b')}>Aller à b</button>
      <button type="button" onClick={() => navigate('c')}>Aller à c</button>
    </div>
  );
}

afterEach(() => {
  // jsdom partage `window` entre les tests d'un même fichier — jamais
  // laisser le pathname d'un test contaminer le suivant.
  window.history.replaceState(null, '', '/');
});

describe('useUrlSyncedTab', () => {
  it('lit l\'onglet actif depuis le pathname au montage', () => {
    window.history.replaceState(null, '', '/c');
    render(<TestHarness />);

    expect(screen.getByText('Onglet actif : c')).toBeInTheDocument();
  });

  it('un pathname sans route déclarée retombe sur fallbackId ET corrige l\'URL affichée', () => {
    window.history.replaceState(null, '', '/nimportequoi');
    render(<TestHarness />);

    expect(screen.getByText('Onglet actif : a')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('navigate() met à jour l\'URL via pushState, sans recharger la page', () => {
    render(<TestHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Aller à b' }));

    expect(screen.getByText('Onglet actif : b')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/b');
  });

  it('navigate() ajoute une entrée d\'historique distincte par onglet (le bouton retour a quelque chose à faire)', () => {
    render(<TestHarness />);
    const lengthBefore = window.history.length;

    fireEvent.click(screen.getByRole('button', { name: 'Aller à b' }));

    expect(window.history.length).toBe(lengthBefore + 1);
  });

  it('cliquer sur l\'onglet déjà actif ne crée pas d\'entrée d\'historique dupliquée', () => {
    window.history.replaceState(null, '', '/b');
    render(<TestHarness />);
    const lengthBefore = window.history.length;

    fireEvent.click(screen.getByRole('button', { name: 'Aller à b' }));

    expect(window.history.length).toBe(lengthBefore);
  });

  it('le bouton retour du navigateur (popstate) restaure l\'onglet précédent', () => {
    render(<TestHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Aller à b' }));
    expect(screen.getByText('Onglet actif : b')).toBeInTheDocument();

    // Simule ce qu'un VRAI bouton retour produit — l'URL change ET un
    // évènement `popstate` est émis — plutôt que `window.history.back()`,
    // dont le traitement asynchrone des entrées `pushState` (sans
    // navigation réelle) est incomplet/peu fiable selon la version de
    // jsdom : ce test cible directement le contrat que `useUrlSyncedTab`
    // documente (écouter `popstate`), pas l'implémentation interne de jsdom.
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByText('Onglet actif : a')).toBeInTheDocument();
  });
});
