import { describe, expect, it } from 'vitest';

import { buildCrossAppUrl, resolveAppOrigins } from './appOrigins';

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
