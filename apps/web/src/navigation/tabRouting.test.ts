import { describe, expect, it } from 'vitest';

import { pathForTab, resolveTabFromPath, type TabRoute } from './tabRouting';

type TabId = 'a' | 'b' | 'c';

const ROUTES: TabRoute<TabId>[] = [
  { id: 'a', path: '/' },
  { id: 'b', path: '/b' },
  { id: 'c', path: '/c' },
];

describe('resolveTabFromPath', () => {
  it('résout l\'onglet dont le chemin correspond exactement', () => {
    expect(resolveTabFromPath(ROUTES, '/b', 'a')).toBe('b');
  });

  it('retombe sur fallbackId pour un chemin qui ne correspond à aucune route', () => {
    expect(resolveTabFromPath(ROUTES, '/nimportequoi', 'a')).toBe('a');
  });

  it('retombe sur fallbackId pour un chemin vide', () => {
    expect(resolveTabFromPath(ROUTES, '', 'a')).toBe('a');
  });
});

describe('pathForTab', () => {
  it('renvoie le chemin déclaré pour un onglet connu', () => {
    expect(pathForTab(ROUTES, 'c')).toBe('/c');
  });

  it('lève une exception explicite pour un onglet sans route déclarée (erreur de configuration)', () => {
    expect(() => pathForTab(ROUTES, 'inconnu' as TabId)).toThrow(
      'Aucun chemin déclaré pour l\'onglet "inconnu".',
    );
  });
});
