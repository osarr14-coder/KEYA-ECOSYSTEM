# Ticket 002 — Hiérarchie Programme → Bien → Lot → Jalon

## Objectif
Un sponsor peut créer un programme, y attacher des biens/lots, et chaque lot obtient
automatiquement ses jalons à partir d'un template configurable — jamais d'une liste
codée en dur.

## Entités touchées
- `Program` (appartient à une `Organization`)
- `Asset` (bien immobilier, appartient à un `Program`)
- `Lot`
- `Milestone`
- `MilestoneTemplate` (lié au `CountryPack`, versionné)

## Scope inclus
- CRUD `Program`, `Asset`, `Lot` scopés par organisation (RLS du ticket 001)
- `MilestoneTemplate` : structure = liste ordonnée de jalons (foncier, conception,
  fondations, gros œuvre, second œuvre, finitions, réception, livraison — valeurs de
  départ pour le Country Pack Sénégal, mais stockées en donnée, pas en enum)
- À la création d'un `Lot`, ses `Milestone` sont instanciés depuis le template actif
  du `CountryPack` du programme
- Endpoint de lecture de la hiérarchie complète d'un programme (pour alimenter BUILD)

## Critères d'acceptation
- [ ] Modifier le contenu d'un `MilestoneTemplate` en base change les jalons créés pour
      les nouveaux lots, sans toucher au code applicatif — testé explicitement
- [ ] Aucun test ni endpoint ne référence un nom de jalon en dur dans le code métier
      (les noms de jalons n'existent que comme données)
- [ ] Un lot appartient toujours à un seul bien, un bien à un seul programme

## Explicitement hors scope
- Pondérations financières des jalons (13.3) — champ prévu dans le schéma mais logique
  de calcul non implémentée à ce stade
- Édition de template via une UI — peut se faire en base pour le MVP

## Dépendances
Ticket 001 (organisations, RLS).
