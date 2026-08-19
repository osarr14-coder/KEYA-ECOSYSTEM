import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { receiveIncomingSession } from './receiveIncomingSession';

function setHash(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe(
  'receiveIncomingSession (ticket 020) — reçoit une session transmise par apps/web via '
  + 'fragment d\'URL',
  () => {
    it('stocke access_token et refresh_token sous les MÊMES clés localStorage que le '
      + 'mécanisme manuel qu\'il remplace', () => {
      setHash('#access_token=my-access&refresh_token=my-refresh');

      receiveIncomingSession();

      expect(localStorage.getItem('keya_access_token')).toBe('my-access');
      expect(localStorage.getItem('keya_refresh_token')).toBe('my-refresh');
    });

    it('retire le fragment de l\'URL une fois consommé — jamais un jeton visible '
      + 'durablement dans la barre d\'adresse', () => {
      setHash('#access_token=my-access&refresh_token=my-refresh');

      receiveIncomingSession();

      expect(window.location.hash).toBe('');
    });

    it('ne fait rien si aucun fragment n\'est présent (chargement normal, pas une '
      + 'redirection depuis apps/web)', () => {
      receiveIncomingSession();

      expect(localStorage.getItem('keya_access_token')).toBeNull();
    });

    it(
      'ne fait rien si le fragment ne contient pas access_token (fragment sans rapport, '
      + 'jamais une supposition sur son contenu)',
      () => {
        setHash('#some-other-fragment=value');

        receiveIncomingSession();

        expect(localStorage.getItem('keya_access_token')).toBeNull();
        expect(window.location.hash).toBe('#some-other-fragment=value');
      },
    );

    it('fonctionne sans refresh_token présent (stocke seulement access_token)', () => {
      setHash('#access_token=my-access');

      receiveIncomingSession();

      expect(localStorage.getItem('keya_access_token')).toBe('my-access');
      expect(localStorage.getItem('keya_refresh_token')).toBeNull();
    });
  },
);
