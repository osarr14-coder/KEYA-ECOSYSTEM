/**
 * Vocabulaire fixe des 5 niveaux Visible Trust (ticket 003,
 * `apps/trust/models.py::TrustLevel`). Les valeurs (`declare`, `documente`,
 * ...) sont volontairement identiques à celles du backend Django : ce n'est
 * PAS un couplage de code (ce package reste un package frontend indépendant,
 * sans dépendance vers `/backend`) mais le même vocabulaire de doctrine
 * produit, cité nommément par les deux tickets — les dupliquer sous des noms
 * différents introduirait une désynchronisation inutile.
 */

export type TrustLevel = 'declare' | 'documente' | 'controle' | 'verifie' | 'valide';

export const ALL_TRUST_LEVELS: TrustLevel[] = [
  'declare', 'documente', 'controle', 'verifie', 'valide',
];

export interface TrustLevelMeta {
  label: string;
  /** Couleur d'appoint — jamais le seul signal, voir shapes.tsx. */
  color: string;
}

export const LEVEL_META: Record<TrustLevel, TrustLevelMeta> = {
  declare: { label: 'Déclaré', color: '#9CA3AF' },
  documente: { label: 'Documenté', color: '#60A5FA' },
  controle: { label: 'Contrôlé', color: '#F59E0B' },
  verifie: { label: 'Vérifié', color: '#34D399' },
  valide: { label: 'Validé', color: '#8B5CF6' },
};
