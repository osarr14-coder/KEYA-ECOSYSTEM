import type { ChecklistItemState, Mission } from './types';

/**
 * Liste statique (mock), PAS un fetch réseau — le backend n'a aujourd'hui
 * aucun concept de "mission assignée à un inspecteur" (`apps/tasks` ne
 * génère des Task que pour le rôle constructeur, voir CLAUDE.md section
 * Task Inbox). Faire remonter une vraie liste de missions depuis le
 * serveur est explicitement de la synchronisation réseau — hors scope de
 * cette passe. Remplacé par un vrai fetch (mis en cache localement pour un
 * usage hors ligne) en passe 2.
 */
export const MOCK_MISSIONS: Mission[] = [
  {
    id: 'mission-1', lotName: 'Lot 12', assetName: 'Résidence Ker',
    programName: 'Programme Keur Massar', milestoneLabel: 'Fondations',
  },
  {
    id: 'mission-2', lotName: 'Lot 07', assetName: 'Résidence Ker',
    programName: 'Programme Keur Massar', milestoneLabel: 'Gros œuvre',
  },
  {
    id: 'mission-3', lotName: 'Lot 03', assetName: 'Villa Almadies',
    programName: 'Programme Almadies Sud', milestoneLabel: 'Second œuvre',
  },
];

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
