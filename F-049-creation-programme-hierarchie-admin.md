# F-049 — Écran de création Program/Asset/Lot (apps/web, admin_keyimmo)

## Contexte

Le ticket B-039 a verrouillé la création de `Program`/`Asset`/`Lot` à
`admin_keyimmo` côté API (bascule RLS explicite, organisation cible fournie
par l'appelant), mais a explicitement exclu tout écran frontend de son
scope (Décision 3) : *« le gatekeeping reste un verrou API pur pour
l'instant ; un écran de création admin (probablement `apps/web`) sera un
ticket frontend séparé »*. Ce ticket ferme ce point.

## Contrat API (déjà en place, vérifié dans `backend/apps/programs/
{views,serializers,services}.py` avant d'écrire ce fichier)

- `POST /api/programs/` — `{organization, name}` → 201 `Program`.
- `POST /api/assets/` — `{organization, program, name, location?}` → 201
  `Asset`. `program` vérifié appartenir à `organization` côté backend
  (`services.create_asset`), pas ici.
- `POST /api/lots/` — `{organization, asset, name, surface?}` → 201 `Lot`.
  Même vérification côté backend pour `asset`.
- `GET /api/procurement/admin/organizations/?q=` (ticket B-028) — recherche
  d'organisation par nom, déjà utilisée par `DevisView.tsx` pour résoudre
  `candidate_organization`. Réutilisée ici telle quelle pour résoudre
  l'organisation CIBLE du programme — aucune distinction de type
  d'organisation n'existe côté backend, donc aucun filtre reconstruit ici.

## Décision de périmètre — flux « wizard » en une session, pas un CRUD complet

Aucun endpoint ne permet aujourd'hui à `admin_keyimmo` de lister les
`Program`/`Asset` d'une organisation dont il n'est pas membre (`ProgramViewSet.list`/
`AssetViewSet.list` sont restés sur `OrganizationScopedMixin`, scopés à
l'organisation ACTIVE de l'appelant — non touchés par B-039, qui n'a
verrouillé que l'écriture). Construire un sélecteur « Program existant »
pour rattacher un nouvel `Asset` demanderait donc un nouvel endpoint de
recherche (même famille que `search_lots_as_admin`/
`search_organizations_as_admin`, ticket B-028) — hors scope de ce ticket.

**Ce ticket couvre donc la création d'une hiérarchie NEUVE en une seule
session** : choisir/rechercher l'organisation cible → créer un `Program` →
lui ajouter un ou plusieurs `Asset` → ajouter un ou plusieurs `Lot` à
chaque `Asset` — en s'appuyant uniquement sur les ids retournés par les
créations précédentes dans CETTE session (aucun besoin de lister quoi que
ce soit côté backend). **Limite assumée, documentée, pas corrigée ici** :
étendre un `Program`/`Asset` créé lors d'une session précédente (perdu du
state React local) n'est pas possible depuis cet écran — nécessiterait le
nouvel endpoint de recherche mentionné ci-dessus, candidat pour un futur
ticket si le besoin se confirme.

## Scope

- Nouvel onglet back-office **« Programmes »** (`apps/web`, réservé
  `admin_keyimmo`, même garde que les 4 onglets existants — `TAB_DEFINITIONS`,
  `App.tsx`).
- `ProgramsView.tsx` : `OrganizationPicker` (réutilisé, voir ci-dessous) →
  formulaire de création `Program` (nom) → une fois créé, formulaire
  répétable de création `Asset` (nom, localisation optionnelle) → pour
  chaque `Asset` créé, formulaire répétable de création `Lot` (nom,
  surface optionnelle).
- `apps/web/src/components/LiveSearchPicker.tsx` (NOUVEAU) : extraction de
  `LiveSearchPicker`/`useDebouncedSearch`, jusqu'ici définis localement
  dans `DevisView.tsx` (deux consommateurs internes : `LotPicker`,
  `OrganizationPicker`). `ProgramsView.tsx` devient un troisième
  consommateur — extrait plutôt que dupliqué, même discipline anti-
  duplication que le reste du projet (voir `buildCrossAppUrl`, F-040).
  Comportement strictement inchangé, `DevisView.tsx` importe désormais
  depuis ce nouveau fichier.
- `apps/web/src/api/types.ts` : ajout `Program`, `Asset`, `Lot` (miroir des
  serializers de lecture `ProgramSerializer`/`AssetSerializer`/
  `LotSerializer`).
- `apps/web/src/api/client.ts` : ajout `createProgram`/`createAsset`/
  `createLot`.

## Hors scope

- `update`/`destroy` de `Program`/`Asset`/`Lot` (déjà gérés côté API par
  B-039, aucun écran ici — pas demandé, pas nécessaire pour débloquer la
  création qui était le vrai manque).
- Un sélecteur « Program/Asset existant » indépendant de la session en
  cours (nécessite un nouvel endpoint de recherche, voir décision de
  périmètre ci-dessus).
- `Milestone` : instanciés automatiquement côté backend
  (`instantiate_milestones_for_lot`, `services.create_lot`), rien à ajouter
  ici.

## Critères d'acceptation

- Un `admin_keyimmo` peut, dans une seule visite de l'écran, créer une
  organisation cible existante (recherche) → un `Program` → au moins un
  `Asset` → au moins un `Lot`, sans quitter l'écran ni ressaisir d'UUID à
  la main.
- Les erreurs de validation backend (ex. nom vide) s'affichent telles que
  renvoyées par l'API (`formatDrfFieldErrors`, même discipline que
  `PricingView`/`LegalPaymentTiersView`).
- `DevisView.test.tsx` reste vert sans modification après l'extraction de
  `LiveSearchPicker` — comportement strictement inchangé.
- Suite `apps/web` verte, `tsc --noEmit` propre.
