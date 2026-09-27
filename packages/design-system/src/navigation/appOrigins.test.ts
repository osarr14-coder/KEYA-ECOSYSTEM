import {
  afterEach, describe, expect, it, vi,
} from 'vitest';

import {
  buildCrossAppUrl, consumeLogoutRequest, logoutToLoginScreen, resolveAppOrigins,
} from './appOrigins';

describe('resolveAppOrigins — retombe sur localhost:<port par défaut> hors configuration', () => {
  it('renvoie les 4 origines par défaut quand aucune variable VITE_*_URL n\'est définie', () => {
    expect(resolveAppOrigins()).toEqual({
      home: 'http://localhost:5173',
      build: 'http://localhost:5174',
      control: 'http://localhost:5175',
      web: 'http://localhost:5176',
    });
  });
});

describe('buildCrossAppUrl — jetons en fragment, jamais en query string', () => {
  it('construit une URL avec access_token et refresh_token après le #', () => {
    const url = buildCrossAppUrl('http://localhost:5174', 'my-access', 'my-refresh');

    expect(url).toBe('http://localhost:5174/#access_token=my-access&refresh_token=my-refresh');
    // Jamais avant le `#` : un fragment n'est jamais envoyé au serveur.
    expect(url.split('#')[0]).toBe('http://localhost:5174/');
  });

  it('encode correctement des jetons contenant des caractères spéciaux', () => {
    const url = buildCrossAppUrl('http://localhost:5174', 'a.b+c/d', 'x&y=z');

    const fragment = new URLSearchParams(url.split('#')[1]);
    expect(fragment.get('access_token')).toBe('a.b+c/d');
    expect(fragment.get('refresh_token')).toBe('x&y=z');
  });
});


describe('déconnexion (ticket F-070)', () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  function seedSession() {
    localStorage.setItem('keya_access_token', 'a');
    localStorage.setItem('keya_refresh_token', 'r');
    localStorage.setItem('keya_active_organization_id', 'o');
    localStorage.setItem('keya_theme', 'dark');
  }

  it('logoutToLoginScreen efface la session de l’origine et ouvre la connexion d’apps/web avec ?logout=1', () => {
    seedSession();
    const assign = vi.fn();

    logoutToLoginScreen(assign);

    expect(localStorage.getItem('keya_access_token')).toBeNull();
    expect(localStorage.getItem('keya_refresh_token')).toBeNull();
    expect(localStorage.getItem('keya_active_organization_id')).toBeNull();
    expect(localStorage.getItem('keya_theme')).toBe('dark');
    expect(assign).toHaveBeenCalledWith('http://localhost:5176/?logout=1');
  });

  it('consumeLogoutRequest efface la session d’apps/web et retire le paramètre de l’URL', () => {
    seedSession();
    window.history.replaceState(null, '', '/?logout=1');

    expect(consumeLogoutRequest()).toBe(true);
    expect(localStorage.getItem('keya_access_token')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('sans ?logout=1, ne touche à rien', () => {
    seedSession();
    expect(consumeLogoutRequest()).toBe(false);
    expect(localStorage.getItem('keya_access_token')).toBe('a');
  });
});
