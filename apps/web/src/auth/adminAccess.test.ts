import { describe, expect, it } from 'vitest';

import type { Me } from '../api/types';
import { deriveAllRoleCodes, hasBackofficeAccess } from './adminAccess';

function makeMe(roleCodes: string[]): Me {
  return {
    id: 'user-1',
    email: 'admin@example.com',
    full_name: 'Admin',
    memberships: roleCodes.map((role_code, index) => ({
      organization_id: `org-${index}`,
      organization_name: `Org ${index}`,
      role_code,
      role_label: role_code,
    })),
  };
}

describe('deriveAllRoleCodes — ticket 021', () => {
  it('renvoie le code de rôle de CHAQUE membership, pas seulement la première', () => {
    expect(deriveAllRoleCodes(makeMe(['constructeur', 'admin_keyimmo']))).toEqual(
      ['constructeur', 'admin_keyimmo'],
    );
  });

  it('déduplique les rôles répétés sur plusieurs organisations', () => {
    expect(deriveAllRoleCodes(makeMe(['admin_keyimmo', 'admin_keyimmo']))).toEqual(['admin_keyimmo']);
  });

  it('renvoie un tableau vide sans aucune membership', () => {
    expect(deriveAllRoleCodes(makeMe([]))).toEqual([]);
  });
});

describe(
  'hasBackofficeAccess — capacité TRANSVERSE, jamais limitée à la première membership '
  + '(même raisonnement que IsAdminKeyimmo côté backend, ticket 011)',
  () => {
    it('accès accordé si admin_keyimmo est la SEULE membership', () => {
      expect(hasBackofficeAccess(makeMe(['admin_keyimmo']))).toBe(true);
    });

    it(
      'accès accordé même si admin_keyimmo n\'est PAS la première membership — '
      + 'contrairement à resolveRedirectApp, qui ne regarde que la première',
      () => {
        expect(hasBackofficeAccess(makeMe(['constructeur', 'admin_keyimmo']))).toBe(true);
      },
    );

    it('ticket F-065 — accès accordé à gestionnaire_adv seul (équipe KEYIMMO)', () => {
      expect(hasBackofficeAccess(makeMe(['gestionnaire_adv']))).toBe(true);
    });

    it('ticket F-065 — gestionnaire_adv hors première membership : accès accordé aussi', () => {
      expect(hasBackofficeAccess(makeMe(['sponsor', 'gestionnaire_adv']))).toBe(true);
    });

    it('accès refusé sans aucune membership admin_keyimmo ni gestionnaire_adv', () => {
      expect(hasBackofficeAccess(makeMe(['constructeur', 'sponsor']))).toBe(false);
    });

    it('accès refusé sans aucune membership du tout', () => {
      expect(hasBackofficeAccess(makeMe([]))).toBe(false);
    });
  },
);
