# Ticket B-033 — Coûts programme (foncier + BE) et répartition entre lots

## Statut

**Implémenté, testé (19 tests dédiés, suite complète 304 tests verte), documenté —
en attente du feu vert utilisateur pour fusion vers `master`.** Conception
tranchée avec l'utilisateur (points A à G), même discipline que les tickets
012/024/025/026/B-027…B-032 : décisions actées avant d'écrire le code, pas
après.

## Origine

Canal 1 (programme immobilier structuré par KEYIMMO) : le foncier et le bureau
d'études (BE) sont des coûts engagés au niveau du PROGRAMME entier, pas par lot
individuellement — à répartir ensuite entre les lots. Section 6 du modèle
économique (`docs/economie/KEYIMMO_Modele_Economique_Consolide.md`) : « coût de
revient de l'écosystème (foncier + construction + bureau d'études + bureau de
contrôle + frais de séquestre/banque) ».

**Terminologie clarifiée avant conception, pour éviter une confusion** :
« bureau d'études » (BE, `be_total` de ce ticket) et « bureau de contrôle » (BC)
sont deux acteurs DISTINCTS dans le modèle économique (section 6, tableau des
postes de coût). L'invariant 25.16 (CLAUDE.md, « budget du bureau de contrôle
sanctuarisé, jamais soumis à l'arbitrage de marge ») concerne le BC, PAS le BE
— ce ticket ne touche donc en rien à cet invariant, aucun lien de conception à
faire entre les deux.

## Vérification préalable — état actuel du modèle `Lot`

`Lot` (`apps/programs/models.py`) ne porte aujourd'hui aucun champ `surface` —
confirmé avant rédaction. Prérequis réel de ce ticket, pas une extension
hypothétique : la méthode `prorata_surface` ne peut pas exister sans cette
donnée.

## Décisions de conception actées

**A. Emplacement — `apps/programs`, pas `apps/pricing`.** `ProgramCost` est
rattaché à UN programme précis (donc à UNE organisation), pas à un
`CountryPack` comme `PricingConfig`/`LegalPaymentTierTemplate` — plus proche
de `Devis` (`apps/procurement`, rattaché à un lot précis) que de la
configuration économique globale par pays. Étend la hiérarchie
Program/Asset/Lot déjà en place, pas un nouveau domaine.

**B. `Lot.surface`** (`apps/programs/models.py`) — `DecimalField(max_digits=10,
decimal_places=2, null=True, blank=True)`. **Nullable, aucune valeur par
défaut inventée** pour les lots déjà existants — cohérent avec la discipline
du projet (jamais un défaut deviné pour une donnée métier réelle). Unité m²
implicite, comme le reste du projet n'a jamais eu besoin d'unité explicite
(ex. montants FCFA sans champ devise). La méthode `prorata_surface` REFUSE
explicitement (erreur dédiée, jamais un partage silencieux à zéro ou une
exclusion silencieuse) si UN SEUL lot du programme n'a pas de surface
renseignée.

**C. RLS — même schéma que `Devis`/`InspectionMission`, PAS celui de
`PricingConfig`.** `ProgramCost.organization` dénormalisé depuis
`program.organization` (même pattern que `Asset.organization`). Policy RLS
`organization_id = current_org` pour `SELECT`/`INSERT` (comparaison de
colonne simple, une seule branche — pas de second acteur cross-organisation
comme le `candidate_organization` de `Devis`) — **aucune policy
`UPDATE`/`DELETE`** (immutabilité, même niveau que `Devis`/`PricingConfig`).
`admin_keyimmo` bascule explicitement le contexte RLS vers l'organisation du
programme pour créer un `ProgramCost` (`set_rls_context`, restauré dans un
`finally`) — même schéma exact que `create_inspection`/`create_devis`,
puisque `admin_keyimmo` n'est structurellement pas membre de cette
organisation.

**D. Sortie de la répartition — lignes SÉPARÉES par lot, PAS un objet
agrégé.** `GET .../repartition/` renvoie une LISTE indexée par lot :
`[{lot_id, foncier_lot, be_lot}, ...]`, jamais un montant combiné — cohérent
avec le tableau du modèle économique (section 6), qui distingue déjà ces
postes ; réutilisable telle quelle par un futur calcul de coût de revient par
lot (foncier + construction + BE + BC), qui a besoin de chaque ligne
séparément.

**E. Arrondi — dérive assumée, PAS de correction du reste.** Aucun mouvement
de fonds réel n'existe dans ce projet (même limite explicite que le ticket
B-027) — une répartition dérivée à la volée, jamais stockée, n'a pas besoin de
garantir que la somme des parts arrondies retombe exactement sur le total au
centime près. `ROUND_HALF_UP` par lot, comme le reste du projet
(`_derive_marge_estimee`, ticket 026) — dette explicite à lever dans un futur
ticket si un vrai mouvement de fonds l'exige (répartition du reste sur le
dernier lot, ou équivalent).

**F. Justification — `TextField` OBLIGATOIRE**, contrairement à `note`
ailleurs dans le projet (`Inspection.note`/`Evidence.note`, tous deux
`blank=True`) — un champ vide est refusé explicitement (400) à chaque
révision, aucune exception.

**G. Endpoints, TOUS réservés à `admin_keyimmo`** (`IsAdminKeyimmo`, ticket
011) :
- `POST /api/programs/{program_id}/costs/` — nouvelle révision
  (`foncier_total`, `be_total`, `repartition_method`, `justification`).
- `GET /api/programs/{program_id}/costs/current/` — dernier enregistrement
  (`LATEST_FIRST_ORDERING`, dérivé, jamais stocké séparément).
- `GET /api/programs/{program_id}/costs/history/` — historique complet,
  chronologique.
- `GET /api/programs/{program_id}/costs/repartition/` — calcul dérivé par
  lot, jamais stocké (décision D pour la forme exacte de la réponse).

`apps/programs/urls.py` utilise aujourd'hui un `DefaultRouter` (ViewSets
scopés organisation standard) — ces 4 routes sont des `APIView` classiques
ajoutées via `path()` explicite à côté du router (même coexistence que dans
d'autres apps de ce projet), pas des actions de ViewSet : la garde
`admin_keyimmo` transverse (pas scopée à l'organisation active) ne s'exprime
pas naturellement dans le mixin `OrganizationScopedMixin` existant.

## Entités touchées

**`ProgramCost`** (`apps/programs/models.py`) :
- `id` (UUID)
- `organization` (FK `Organization`, `CASCADE` — dénormalisé depuis
  `program.organization`, même pattern que `Asset.organization`)
- `program` (FK `Program`, `PROTECT`)
- `foncier_total` (`DecimalField`, montant FCFA)
- `be_total` (`DecimalField`, montant FCFA)
- `repartition_method` (`CharField`, choix `prorata_surface`/`parts_egales`)
- `justification` (`TextField`, OBLIGATOIRE — décision F)
- `created_by` (FK `User`, `PROTECT`)
- `created_at` (auto)
- `sequence` (`BigIntegerField`, unique, `nextval()` sur séquence Postgres
  dédiée — même mécanisme que `TrustEvent.sequence`/`PricingConfig.sequence`,
  construit dès la conception cette fois, pas retrofit après un flake comme
  au ticket B-031)

`LATEST_FIRST_ORDERING = ('-created_at', '-sequence')` — valeur courante
TOUJOURS dérivée du dernier enregistrement, aucun champ séparé (`is_active`,
`current_foncier`...).

**`Lot.surface`** (décision B) — nouveau champ, migration séparée du reste du
schéma `programs` existant.

## Scope inclus

- `Lot.surface` (décision B) + migration.
- `ProgramCost` + migration (modèle + `sequence`, décision A/C).
- RLS `ProgramCost` : `SELECT`/`INSERT` scopés organisation, aucune
  `UPDATE`/`DELETE` (décision C).
- `apps.programs.services.create_program_cost` — bascule RLS explicite vers
  l'organisation du programme, garde `justification` non vide, garde
  `repartition_method` valide.
- `apps.programs.services.get_current_program_cost`/
  `get_program_cost_history` — dérivation, jamais stockage séparé.
- `apps.programs.services.compute_lot_repartition` — calcul à la volée
  (décision D pour la forme, E pour l'arrondi), refuse explicitement
  `prorata_surface` si un lot du programme n'a pas de `surface` (décision B).
- 4 endpoints (décision G) + serializers.

## Explicitement hors scope

- **Tout mouvement de fonds réel** — répartition purement informative/
  dérivée, comme `LegalPaymentTierTemplate` (ticket B-027) : structure et
  calcul, jamais un appel de fonds.
- **Bureau de contrôle (BC)** — invariant 25.16, budget sanctuarisé, sujet
  DISTINCT non traité par ce ticket (voir « Origine » ci-dessus).
- **Correction du reste d'arrondi** (décision E) — dette explicite pour un
  futur ticket.
- **Câblage avec `Devis`/le coût de revient d'un lot** — ce ticket construit
  la structure et le calcul de répartition seuls, un futur ticket devra les
  connecter à un calcul de coût de revient complet par lot (même discipline
  que ticket 025 → ticket 026 pour `PricingConfig`).
- **Toute UI.**

## Critères d'acceptation

- [x] `Lot.surface` existe, nullable, aucune valeur par défaut posée sur les
      lots existants.
- [x] `admin_keyimmo` peut créer une révision `ProgramCost` pour un programme
      dont il n'est PAS membre (bascule RLS) ; tout autre rôle → 403.
- [x] `justification` vide ou absente → refusé (400), aucune ligne créée.
- [x] `repartition_method` invalide (hors `prorata_surface`/`parts_egales`)
      → refusé (400).
- [x] `GET .../current/` renvoie le DERNIER `ProgramCost` créé
      (`LATEST_FIRST_ORDERING`), jamais un champ `is_active` basculé.
- [x] `GET .../history/` renvoie l'historique complet, chronologique.
- [x] `GET .../repartition/` avec `parts_egales` : chaque lot du programme
      reçoit une part strictement égale de `foncier_total`/`be_total`.
- [x] `GET .../repartition/` avec `prorata_surface` : chaque lot reçoit une
      part proportionnelle à `Lot.surface` — testé avec des surfaces
      différentes, pas seulement égales (preuve que la proportion est
      réellement calculée, pas une coïncidence).
- [x] `GET .../repartition/` avec `prorata_surface` ET au moins un lot sans
      `surface` renseignée → refusé explicitement (erreur dédiée), jamais un
      partage silencieux à zéro.
- [x] **Forme de la réponse de `GET .../repartition/` — liste indexée par
      lot** (`[{lot_id, foncier_lot, be_lot}, ...]`), JAMAIS un objet agrégé
      — testé explicitement (précision demandée par l'utilisateur).
- [x] `ProgramCost` est immuable après création — aucune policy RLS
      `UPDATE`/`DELETE`, testée comme une tentative EXPLICITE refusée (SQL
      brut, `rowcount == 0`), pas seulement une absence de route ; aucune
      fonction `update`/`delete` dans `services.py` (`hasattr`).
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits
      avant de considérer le ticket terminé.
- [x] Test de collision forcée sur `sequence` (`timezone.now` gelé sur deux
      créations séparées), construit dès la conception, jamais en retrofit.

## Notes d'implémentation

**Point d'accès non anticipé dans la proposition initiale, corrigé en
implémentant** : `POST/GET .../costs/...` a besoin d'un `organization`/
`organization_id` explicite (corps pour la création, paramètre de requête
pour les lectures) — la proposition initiale ne le mentionnait pas
explicitement, mais c'est une conséquence directe et déjà connue du schéma
RLS choisi (décision C) : lire `Program` sous le contexte RLS de l'admin
échouerait silencieusement s'il n'est pas membre de cette organisation, donc
l'organisation cible ne peut jamais être dérivée après coup depuis
`program_id` seul — même schéma que `DevisCreateSerializer`/
`DevisAdminListView` (ticket 022). Ajouté sans redemander confirmation
puisqu'il découle mécaniquement d'une décision déjà actée, pas d'un nouveau
choix.

**`Lot.surface` — pas de nouvel endpoint, réutilisation de l'infrastructure
existante** : `LotViewSet` est déjà un `ModelViewSet` complet — `surface`
ajouté simplement à `LotSerializer` (champ écrit via le `PATCH` générique déjà
disponible), plutôt que d'inventer un mécanisme dédié non demandé par le
ticket.

**Deux erreurs trouvées en écrivant les tests, aucune liée à la logique
métier du ticket** :
1. **Piège RLS classique, déjà documenté au ticket 022, reproduit ici par
   inattention** : mes trois premiers tests d'immutabilité appelaient
   `program_cost.refresh_from_db()`/`ProgramCost.objects.filter(...).exists()`
   directement après une bascule RLS déjà restaurée vers l'organisation de
   l'admin — `programs_program_cost` étant scopée organisation (contrairement
   à `pricing_pricingconfig`), ces relectures échouaient silencieusement
   (`DoesNotExist`/résultat vide). Corrigé en basculant explicitement
   (`set_rls_context(organization_id=sponsor_org.id)`) avant chaque relecture
   de vérification, même discipline que `TestDevisImmutability`
   (`apps/procurement/tests.py`).
2. **Collision fortuite avec le test-garde `TestNoHardcodedMilestoneNames`
   (ticket 002)** : deux codes de jalon RÉELLEMENT seedés
   (`foncier`/`conception`) sont aussi, respectivement, un fragment du nom de
   champ légitime `ProgramCost.foncier_total` et un mot français ordinaire
   employé dans mes propres docstrings (« décisions de conception ») — la
   correspondance par sous-chaîne brute du test-garde produisait un faux
   positif sans rapport avec son intention réelle (empêcher un CODE de jalon
   codé en dur comme littéral de chaîne). Corrigé en resserrant la
   correspondance sur le littéral de chaîne (code entouré de guillemets),
   une amélioration justifiée de précision du garde-fou, pas un
   affaiblissement — toujours détecté avec cette précision, seule la fausse
   alerte disparaît.

**Suite de tests** : 19 tests dédiés (surface du lot, création/permissions/
validations, current/history, immutabilité RLS, répartition — parts égales,
prorata surface avec surfaces différentes, refus explicite si surface
manquante, forme exacte de la réponse, refus si aucun coût enregistré —
collision forcée de `sequence`). Suite `programs` complète : 35 tests. Suite
complète du projet : 304 tests, tous verts.
