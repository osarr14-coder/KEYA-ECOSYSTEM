# Ticket 012 — Affectation de mission à un inspecteur

## Objectif
Combler l'angle mort révélé par le test bout-en-bout du vertical slice MVP 1 (doctrine
V3.0 §22.4) : `CONTROL PWA` (ticket 010) n'a jamais consommé de vraie liste de missions —
elle a été construite et testée intégralement contre `MOCK_MISSIONS`, un jeu de données
codé en dur, faute d'un concept d'assignation d'inspecteur côté serveur. Ce ticket résout
aussi, au passage, une limite explicitement documentée dès le ticket 005 : « l'inspecteur
ne peut pas relire ses inspections passées via l'API — nécessiterait une requête
cross-organisation dédiée, hors scope de ce ticket ». C'est précisément cette requête
dédiée que ce ticket construit.

## Décisions de conception proposées (à trancher avant implémentation)

### 1. Qui peut créer une affectation ?

**Proposition : réservé à `admin_keyimmo`, aucun autre rôle.**

Justification au regard de la règle d'indépendance du contrôle (V3.0 §2.3, déjà appliquée
au ticket 005 par `apps.inspections.services.create_inspection` /
`IndependenceRuleViolation`) : si le constructeur pouvait choisir LUI-MÊME quel inspecteur
contrôle son propre travail — même indirectement, en « demandant » un inspecteur précis —
la règle d'indépendance serait affaiblie dès l'affectation, avant même la première
inspection. `admin_keyimmo` est la seule partie qui n'a d'intérêt direct dans aucun des
deux camps (constructeur ni inspecteur) — c'est exactement le rôle que le ticket 011 a
déjà positionné comme opérateur de plateforme, avec une visibilité transverse à toutes les
organisations. Réutiliser ce rôle plutôt qu'en créer un nouveau.

L'endpoint de création doit revalider la règle d'indépendance **à l'affectation**, pas
seulement à l'inspection elle-même (`assigned_inspector` ne doit jamais appartenir à
l'organisation du `work_declaration` ciblé) — sans quoi une affectation invalide pourrait
exister en base, silencieusement inutilisable, jusqu'à l'échec tardif de
`create_inspection`.

**Explicitement hors scope de ce ticket** (extensions possibles, non nécessaires au MVP) :
demande d'inspection initiée par le constructeur (sans choix de l'inspecteur précis) ;
auto-attribution par l'inspecteur lui-même sur un vivier de missions disponibles
(marketplace) — les deux sont de vrais patterns produit valables, mais ni l'un ni l'autre
n'est requis pour que `CONTROL PWA` ait une vraie liste de missions à afficher.

### 2. Modèle séparé ou réutilisation de `Task` (ticket 006) ?

**Proposition : un modèle séparé, `InspectionMission` (dans `apps.inspections` — le
domaine qui possède déjà la règle d'indépendance), PAS une réutilisation directe de
`Task`.** `Task` reste utilisée, mais uniquement comme effet de bord de notification,
exactement le rôle qu'elle joue déjà pour `Reserve` (ticket 006).

Justification :
- `Task` est un objet **transversal générique** (`apps/tasks`, label `inbox_tasks`) —
  CLAUDE.md est explicite : « apps/core ne contient que ce qui est réellement transverse
  […] pas de logique propre à un domaine métier ». Le même principe s'applique à
  `apps/tasks` : elle sait afficher un inbox, pas arbitrer une règle métier aussi
  spécifique que l'indépendance du contrôle. Faire porter cette validation par
  `apps.tasks.services` entortillerait de la logique `apps.inspections` dans une app
  transverse.
- Une mission a des champs propres qu'un `Task` générique n'a pas de raison de porter
  (l'organisation cible pour la RLS, le `work_declaration` précis, l'inspecteur assigné
  distinct de l'« assignee » générique) — les forcer dans `Task.subject`
  (`GenericForeignKey`) marcherait techniquement, mais `CONTROL PWA` aurait alors besoin
  de désérialiser un objet générique pour en extraire des champs métier précis à chaque
  affichage, plutôt que de lire un serializer dédié.
- Le précédent déjà établi (`Reserve` ↔ `Task`, ticket 006) est EXACTEMENT ce schéma :
  `_open_new_reserve` crée la `Reserve` (objet métier, dans `apps.inspections`) puis
  déclenche `process_reserve_opened.delay(...)` qui génère une `Task` de notification —
  « les deux sont des tables sans lien de suppression en cascade entre elles (référence
  polymorphe, pas de FK réelle) ». Ce ticket reproduit le même schéma : `InspectionMission`
  est l'objet métier, une `Task` (type existant, ou nouveau type si le rôle du ticket 011
  a besoin de le distinguer dans son propre inbox — à trancher à l'implémentation) notifie
  l'inspecteur qu'une mission lui a été affectée.

**Pas de champ `status` stocké sur `InspectionMission`** (contrairement à `Task`, qui est
une exception documentée à la doctrine) : une mission est « faite » si une `Inspection`
existe déjà pour son `work_declaration`, créée par l'inspecteur assigné — entièrement
dérivable, exactement la doctrine Visible Trust appliquée sans exception cette fois.

### 3. Comment `CONTROL PWA` récupère la liste réelle des missions

**Proposition : `GET /api/control/missions/`, scopé sur l'inspecteur courant
(`assignee = request.user`), avec une policy RLS dédiée qui évite explicitement le piège
rencontré au ticket 011.**

`InspectionMission` porte un `organization_id` dénormalisé (celui du `work_declaration`
ciblé, RLS standard) — mais l'inspecteur assigné n'est, par construction (règle
d'indépendance), jamais membre de cette organisation. Une lecture cross-organisation est
donc nécessaire, comme pour `Inspection`/`Reserve`. Contrairement à la tentative
abandonnée au ticket 011 (élargir `membership_select` avec une sous-requête sur SA PROPRE
table — récursion infinie détectée par Postgres sous `FORCE ROW LEVEL SECURITY`), la
policy proposée ici compare une colonne à `current_user_id`, **sans sous-requête** :

```sql
USING (organization_id = current_org OR assigned_inspector_id = current_user)
```

C'est structurellement identique à la policy `membership_select` D'ORIGINE (`user_id =
current_user`, ticket 001), qui a toujours fonctionné sans problème — la leçon du ticket
011 n'est pas « toute clause OR est dangereuse », c'est spécifiquement « une sous-requête
qui relit sa propre table déclenche une récursion sous FORCE RLS ». Cette policy n'en
comporte aucune. À vérifier en SQL brut avant tout commit (même rigueur que les tickets
001/011), mais le risque structurel identifié au ticket 011 ne s'applique pas ici.

Côté `CONTROL PWA` : `MOCK_MISSIONS` est remplacé par un vrai fetch au retour du réseau
(réutilise le moteur de synchronisation du ticket 010, `syncEngine.ts`), mis en cache
localement pour l'usage hors ligne déjà construit — la mission list devient un objet de
plus écrit en IndexedDB avant toute tentative réseau supplémentaire, pas une exception au
modèle déjà en place.

## Entités touchées
- `InspectionMission` (nouveau modèle, `apps.inspections`) — cible un `WorkDeclaration`
  existant, assigné à un `User` (rôle inspecteur), posé par un `User` (rôle admin_keyimmo)
- `Task` (ticket 006) — réutilisée comme notification (effet de bord Celery), jamais comme
  source de vérité de la mission elle-même
- Back-office (`apps.backoffice`, ticket 011) — nouvel endpoint de création, réservé à
  `admin_keyimmo`, délègue la validation métier à `apps.inspections.services`
- `CONTROL PWA` (`apps/control-pwa`) — `MOCK_MISSIONS` remplacé par un vrai fetch

## Scope inclus
- Modèle `InspectionMission` : `work_declaration`, `assigned_inspector`, `assigned_by`,
  `organization` (dénormalisé), `created_at` — pas de champ statut stocké (dérivé, voir
  ci-dessus)
- Validation de la règle d'indépendance à la création de la mission (pas seulement à
  l'inspection), réutilisant le même principe que `create_inspection`
  (`IndependenceRuleViolation`)
- Endpoint de création réservé à `admin_keyimmo` (`apps.backoffice`, réutilise
  `IsAdminKeyimmo` du ticket 011)
- `GET /api/control/missions/` : liste des missions assignées à l'inspecteur courant,
  avec statut dérivé (faite / à faire) selon l'existence d'une `Inspection` correspondante
- Policy RLS dédiée sur `InspectionMission` (comparaison de colonne, pas de sous-requête
  — voir point 3 ci-dessus), avec son test de non-contournement en SQL brut
- Génération d'une `Task` de notification à l'affectation, réutilisant le pattern Celery
  déjà validé (`organization_id`/`actor_user_id` explicites, `transaction.atomic()`,
  `.delay()` réel)
- `CONTROL PWA` : remplacement de `MOCK_MISSIONS` par un vrai fetch, mis en cache
  localement (réutilise `syncEngine.ts`/IndexedDB du ticket 010, aucune nouvelle logique
  de stockage local)

## Critères d'acceptation
- [ ] Une tentative d'affectation où l'inspecteur assigné appartient à l'organisation du
      `work_declaration` ciblé est rejetée explicitement (règle d'indépendance, testée à
      l'affectation, pas seulement à l'inspection)
- [ ] Seul un membre `admin_keyimmo` peut créer une affectation — testé comme une
      tentative explicite refusée pour tout autre rôle, pas une simple absence de bouton
      côté UI
- [ ] Un inspecteur authentifié ne peut lister QUE ses propres missions (jamais celles
      d'un autre inspecteur), vérifié en SQL brut au niveau de la policy RLS elle-même —
      pas seulement via l'API
- [ ] Un inspecteur assigné à une mission la voit bien, même si elle appartient à une
      organisation différente de la sienne (comportement voulu — c'est tout le sens de la
      règle d'indépendance) — MAIS ne voit RIEN d'autre de cette organisation au-delà de
      cette mission précise : testé explicitement par la négative, pas seulement par
      l'absence d'écran côté frontend. À couvrir dans un même test : un second lot de
      cette organisation (sans mission assignée à cet inspecteur) reste invisible, une
      autre `Inspection`/`Reserve` de cette organisation reste invisible, et
      `GET /api/programs/`, `/api/assets/`, `/api/lots/` (ticket 002) ne renvoient RIEN de
      cette organisation pour cet inspecteur — la policy RLS élargie de ce ticket ne doit
      élargir l'accès QU'à `InspectionMission`, jamais par ricochet à une autre table
      scopée par organisation
- [ ] `CONTROL PWA` affiche une vraie liste de missions issue du backend pour un
      inspecteur de test, sans aucune référence à `MOCK_MISSIONS` dans le chemin
      d'affichage par défaut

## Explicitement hors scope
- Demande d'inspection initiée par le constructeur (sans choix d'inspecteur précis)
- Auto-attribution par l'inspecteur sur un vivier de missions disponibles (marketplace)
- Réassignation ou annulation d'une mission déjà créée
- Affectation anticipée au niveau d'un `Milestone` avant toute `WorkDeclaration`
  (une mission cible toujours un `WorkDeclaration` existant, jamais un jalon nu)
- Matrice de compétences/certification des inspecteurs (est-ce que CET inspecteur est
  qualifié pour CE type de contrôle) — un `User` avec le rôle `inspecteur` suffit pour ce
  MVP
- Notifications temps réel (même limite déjà posée aux tickets 006/010/011)

## Dépendances
Tickets 002 (Lot/Milestone), 004 (WorkDeclaration), 005 (règle d'indépendance,
`create_inspection`), 006 (Task, pattern de notification Celery), 010 (CONTROL PWA,
`MOCK_MISSIONS` à remplacer), 011 (rôle `admin_keyimmo`, back-office, leçon RLS sur les
policies auto-référentielles).
