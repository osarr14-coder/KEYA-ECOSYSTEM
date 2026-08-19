import { describe, expect, it } from 'vitest';

import type { Me } from '../api/types';
import { buildRedirectUrl, isSameOriginRedirect, resolveRedirectApp } from './redirectTarget';

function makeMe(roleCode: string | null): Me {
  return {
    id: 'user-1', email: 'a@example.com', full_name: 'A',
    memberships: roleCode
      ? [{ organization_id: 'org-1', organization_name: 'Org', role_code: roleCode, role_label: roleCode }]
      : [],
  };
}

describe('resolveRedirectApp — mapping rôle → app (ticket 020)', () => {
  it('inspecteur -> control', () => {
    expect(resolveRedirectApp(makeMe('inspecteur'))).toBe('control');
  });

  it('constructeur -> build', () => {
    expect(resolveRedirectApp(makeMe('constructeur'))).toBe('build');
  });

  it('client -> home', () => {
    expect(resolveRedirectApp(makeMe('client'))).toBe('home');
  });

  it('sponsor -> home (aucune app FINANCE dédiée déployée)', () => {
    expect(resolveRedirectApp(makeMe('sponsor'))).toBe('home');
  });

  it(
    'admin_keyimmo -> web (ticket 021 : le back-office vit désormais dans apps/web '
    + 'elle-même — évolution volontaire du mapping "tout autre rôle -> HOME" du ticket 020, '
    + 'pas un oubli, voir le commentaire de resolveRedirectApp)',
    () => {
      expect(resolveRedirectApp(makeMe('admin_keyimmo'))).toBe('web');
    },
  );

  it('aucune membership -> home (fallback sûr, jamais une erreur bloquante)', () => {
    expect(resolveRedirectApp(makeMe(null))).toBe('home');
  });

  it(
    'utilise la PREMIÈRE membership seulement — même convention que le fallback de '
    + 'l\'App Switcher (ticket 019) et le défaut backend sans X-Organization-Id',
    () => {
      const me: Me = {
        id: 'user-1', email: 'a@example.com', full_name: 'A',
        memberships: [
          { organization_id: 'org-1', organization_name: 'Org 1', role_code: 'constructeur', role_label: 'Constructeur' },
          { organization_id: 'org-2', organization_name: 'Org 2', role_code: 'inspecteur', role_label: 'Inspecteur' },
        ],
      };
      expect(resolveRedirectApp(me)).toBe('build');
    },
  );
});

describe('buildRedirectUrl — jetons en fragment, jamais en query string', () => {
  it('construit une URL avec access_token et refresh_token après le #', () => {
    const url = buildRedirectUrl('http://localhost:5174', 'my-access', 'my-refresh');

    expect(url).toBe('http://localhost:5174/#access_token=my-access&refresh_token=my-refresh');
    // Jamais avant le `#` : un fragment n'est jamais envoyé au serveur.
    expect(url.split('#')[0]).toBe('http://localhost:5174/');
  });

  it('encode correctement des jetons contenant des caractères spéciaux', () => {
    const url = buildRedirectUrl('http://localhost:5174', 'a.b+c/d', 'x&y=z');

    const fragment = new URLSearchParams(url.split('#')[1]);
    expect(fragment.get('access_token')).toBe('a.b+c/d');
    expect(fragment.get('refresh_token')).toBe('x&y=z');
  });
});

describe(
  'isSameOriginRedirect (ticket 021) — bug réel trouvé en vérification navigateur : un '
  + 'changement de fragment seul ne recharge jamais le document',
  () => {
    it('même origine (admin_keyimmo -> apps/web elle-même) -> true', () => {
      expect(isSameOriginRedirect(
        'http://localhost:5176/#access_token=a&refresh_token=b',
        'http://localhost:5176/',
      )).toBe(true);
    });

    it('origine différente (HOME/BUILD/CONTROL) -> false', () => {
      expect(isSameOriginRedirect(
        'http://localhost:5174/#access_token=a&refresh_token=b',
        'http://localhost:5176/',
      )).toBe(false);
    });

    it('même hôte mais port différent -> false (une origine inclut le port)', () => {
      expect(isSameOriginRedirect('http://localhost:5177/', 'http://localhost:5176/')).toBe(false);
    });
  },
);
