import type { ChecklistItemState, Mission } from './types';

/**
 * Liste statique (mock), PAS un fetch réseau — le backend n'a aujourd'hui
 * aucun concept de "mission assignée à un inspecteur" (`apps/tasks` ne
 * génère des Task que pour le rôle constructeur, voir CLAUDE.md section
 * Task Inbox). Faire remonter une vraie liste de missions depuis le
 * serveur reste hors scope (limite documentée, non résolue par la passe 2 —
 * voir CLAUDE.md, addendum passe 2) : `organizationId`/`workDeclarationId`
 * ci-dessous sont donc eux-mêmes des identifiants FICTIFS pour les tests
 * automatisés (l'API est mockée), sans correspondance en base par défaut.
 * Une vérification manuelle en conditions réelles nécessite de les
 * remplacer temporairement par de vrais UUID backend (voir procédure dans
 * CLAUDE.md) — jamais commité tel quel.
 */
export const MOCK_MISSIONS: Mission[] = [
  {
    id: 'mission-1', lotName: 'Lot 12', assetName: 'Résidence Ker',
    programName: 'Programme Keur Massar', milestoneLabel: 'Fondations',
    organizationId: '00000000-0000-0000-0000-0000000000a1',
    workDeclarationId: '00000000-0000-0000-0000-0000000000b1',
  },
  {
    id: 'mission-2', lotName: 'Lot 07', assetName: 'Résidence Ker',
    programName: 'Programme Keur Massar', milestoneLabel: 'Gros œuvre',
    organizationId: '00000000-0000-0000-0000-0000000000a1',
    workDeclarationId: '00000000-0000-0000-0000-0000000000b2',
  },
  {
    id: 'mission-3', lotName: 'Lot 03', assetName: 'Villa Almadies',
    programName: 'Programme Almadies Sud', milestoneLabel: 'Second œuvre',
    organizationId: '00000000-0000-0000-0000-0000000000a2',
    workDeclarationId: '00000000-0000-0000-0000-0000000000b3',
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
