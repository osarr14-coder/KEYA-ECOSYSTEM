import type { ChecklistItemState } from './types';

/**
 * Checklist FIXE, générique — le backend ne modélise aujourd'hui aucun
 * "template de checklist de contrôle" (`Inspection` n'a qu'un `outcome`
 * global, voir apps/inspections/models.py). Documenté comme provisoire :
 * un futur ticket pourrait vouloir un template par CountryPack, sur le
 * même principe que `MilestoneTemplate` (ticket 002) — hors scope ici.
 */
export const CHECKLIST_TEMPLATE: ChecklistItemState[] = [
  { id: 'securite', label: 'Sécurité du chantier', checked: false },
  { id: 'conformite_plans', label: 'Conformité aux plans', checked: false },
  { id: 'materiaux', label: 'Qualité des matériaux', checked: false },
  { id: 'proprete', label: 'Propreté du site', checked: false },
];
