# Ticket B-034 — Barème sectoriel du bureau de contrôle

## Statut

**Implémenté, testé (18 tests dédiés, suite complète 303 tests verte), documenté —
en attente du feu vert utilisateur pour fusion vers `master`.** Conception tranchée
avec l'utilisateur (points A à G), même discipline que les tickets
012/024/025/026/B-027…B-033 : décisions actées avant d'écrire le code, pas après.

## Origine

Invariant 25.16 (CLAUDE.md) : « le budget du bureau de contrôle est sanctuarisé,
indexé sur un barème sectoriel, jamais soumis à l'arbitrage de marge de KEYIMMO
ni à une négociation. » Marqué *pas encore applicable* jusqu'ici (aucun barème
n'existait). Section 6/6bis du modèle économique
(`docs/economie/KEYIMMO_Modele_Economique_Consolide.md`, ligne 194) : « Sanctuarisation
du budget bureau de contrôle — Concept nouveau à modéliser ». Ce ticket construit
ce concept.

**Point vérifié avant rédaction — citation retirée** : « invariant 8.4 » cité dans
la demande initiale est introuvable dans `CLAUDE.md` et le document de référence
(même vérification que pour « invariant 20.4 » au ticket B-030) — non utilisé
comme référence dans ce ticket. Le raisonnement métier qui l'accompagnait (aucun
critère subjectif de type « rigueur documentaire », uniquement des critères
objectifs et vérifiables) reste valide indépendamment de cette citation absente.

## Vérification préalable — types de jalon déjà réutilisables

`MilestoneTemplateStep.code` (`apps/programs/migrations/
0003_seed_senegal_milestone_template.py`) — `CharField` libre, déjà seedé pour
le Sénégal (`foncier`, `conception`, `fondations`, `gros_oeuvre`,
`second_oeuvre`, `finitions`, `reception`, `livraison`). Confirme la décision
ci-dessous : `jalon_type` doit être une référence LIBRE (même raisonnement que
`LegalPaymentTierStep.code`, ticket B-027, décision C) — jamais une FK stricte
vers `MilestoneTemplateStep`, pour ne pas coupler artificiellement deux
structures qui évoluent indépendamment (un régime de barème BC peut changer
sans toucher la séquence de jalons de construction, et réciproquement).

## Décisions de conception actées

**A. `ControlOfficeRate`, `apps/pricing`** — convention anglaise pour les
entités techniques déjà établie dans ce projet (tickets français, code anglais
sauf vocabulaire produit explicitement nommé ainsi). Même famille que
`PricingConfig`/`LegalPaymentTierTemplate`, PAS le schéma RLS de `Devis`/
`ProgramCost` (B-033) : donnée de référence par `CountryPack`, jamais liée à
une organisation précise.

**B. Deux champs valeur, un seul actif à la fois — garanti par une contrainte
DB, pas seulement applicative.** `calculation_mode`
(`percentage`/`fixed_amount`), `percentage` et `fixed_amount` tous deux
nullable — un `CheckConstraint` en base garantit qu'EXACTEMENT un des deux est
renseigné selon le mode choisi, jamais une simple vérification côté service
contournable. Cohérence explicite avec la rigueur déjà appliquée ailleurs dans
ce projet pour ce type de garantie (ex. B-027/décision D-bis, contrainte
`UNIQUE` réelle plutôt qu'une vérification applicative seule).

**C. Garde `is_active` du `CountryPack`, dès la conception — pas en retrofit.**
B-032 a fermé cette dette pour `PricingConfig`/`LegalPaymentTierTemplate` APRÈS
coup ; `create_control_office_rate` vérifie `CountryPack.is_active` DÈS ce
ticket, en réutilisant `CountryPackInactiveError` (déjà défini dans
`apps/pricing/services.py`, même app — pas une variante dupliquée).

**D. « Le barème est LA seule source du montant » — garde par test dédié, ET
note CLAUDE.md explicitement adressée aux tickets consommateurs à venir.**
Un test vérifie qu'aucune fonction de service, nulle part dans le projet,
n'expose de mécanisme alternatif de saisie/calcul d'un montant bureau de
contrôle (`hasattr`, même famille que les gardes d'immutabilité déjà en place).
Pas de scan AST projet-entier ici (contrairement à B-031) : aucun autre code ne
calcule encore de montant BC aujourd'hui, rien à scanner utilement.

**Précision explicite de l'utilisateur** : la note `CLAUDE.md` de ce ticket doit
nommer NOMMÉMENT les tickets consommateurs annoncés (B-035/B-036, « grand-livre
par lot ») et la fonction exacte à appeler
(`apps.pricing.services.get_active_control_office_rate`) — pas une formule
générique du type « à utiliser plus tard ». Objectif : qu'une session qui
rédigera B-035 lise cette note et sache immédiatement qu'elle doit APPELER
cette fonction pour lire le montant BC d'un lot/jalon, jamais recalculer le
pourcentage/montant elle-même ni dupliquer la logique de dérivation
(`calculation_mode` → `percentage` × coût de construction OU `fixed_amount`
direct) dans `apps/procurement`/un futur module de grand-livre.

**E. `current`/`history` exigent `country_pack_id` ET `jalon_type` ensemble.**
Contrairement à `PricingConfig.get_current_rates` (qui énumère ses 2 canaux
FIXES, `PricingCanal`), `jalon_type` est une chaîne libre sans liste connue à
l'avance — impossible d'énumérer « tous les jalons » d'un `CountryPack` sans
recourir à `MilestoneTemplateStep` (couplage explicitement écarté, décision
ci-dessus). `GET .../current/` et `GET .../history/` portent donc TOUJOURS les
deux paramètres, jamais un seul.

**F. RLS et permissions — identiques à `PricingConfig`.** Aucune colonne
`organization_id` (donnée de référence par pays, pas par organisation) ;
policies RLS `SELECT`/`INSERT` permissives (`USING (true)`/`WITH CHECK
(true)`), **aucune policy `UPDATE`/`DELETE`** (immutabilité). Lecture réservée
à `admin_keyimmo` — permission DRF (`IsAdminKeyimmo`), jamais une policy RLS.

**G. Bonus/malus de ponctualité — EXPLICITEMENT hors scope**, reporté à un
futur ticket séparé, basé uniquement sur un critère objectif et vérifiable
(échéance de mission vs horodatage réel du `TrustEvent` « validé »).

## Entités touchées

**`ControlOfficeRate`** (`apps/pricing/models.py`) :
- `id` (UUID)
- `country_pack` (FK `CountryPack`, `PROTECT`)
- `jalon_type` (`CharField`, libre — décision, voir vérification préalable)
- `calculation_mode` (`CharField`, choix `percentage`/`fixed_amount`)
- `percentage` (`DecimalField`, nullable)
- `fixed_amount` (`DecimalField`, nullable)
- `created_by` (FK `User`, `PROTECT`)
- `created_at` (auto)
- `sequence` (`BigIntegerField`, unique, `nextval()` sur séquence Postgres
  dédiée — construit dès la conception, comme `ProgramCost` au ticket B-033,
  pas un retrofit après un flake comme `PricingConfig` a dû le faire au
  ticket B-031)
- `CheckConstraint` (décision B) garantissant l'exclusivité `percentage`/
  `fixed_amount` selon `calculation_mode`.

`LATEST_FIRST_ORDERING = ('-created_at', '-sequence')` — valeur courante
TOUJOURS dérivée du dernier enregistrement pour un `(country_pack, jalon_type)`
donné, aucun champ séparé.

## Scope inclus

- `ControlOfficeRate` + migration (modèle, `sequence`, `CheckConstraint`, RLS).
- `apps.pricing.services.create_control_office_rate` — vérifie `justification`
  n'est PAS un champ de ce ticket (contrairement à `ProgramCost`, non demandé
  ici) ; vérifie `CountryPack.is_active` (décision C) ; vérifie l'exclusivité
  `percentage`/`fixed_amount` selon `calculation_mode` AVANT toute écriture
  (même discipline que `LotAlreadyLockedError`/validation des plafonds
  cumulés : refus explicite, aucune ligne créée).
- `apps.pricing.services.get_active_control_office_rate`/
  `get_control_office_rate_history` — dérivation, jamais stockage séparé.
- 3 endpoints, tous `admin_keyimmo` uniquement :
  - `POST /api/pricing/control-office-rates/`
  - `GET /api/pricing/control-office-rates/current/?country_pack_id=&jalon_type=`
  - `GET /api/pricing/control-office-rates/history/?country_pack_id=&jalon_type=`
- Garde par test (décision D) + note `CLAUDE.md` explicitement adressée aux
  tickets B-035/B-036.

## Explicitement hors scope

- **Bonus/malus de ponctualité** (décision G) — futur ticket séparé, critère
  objectif uniquement.
- **Tout mouvement de fonds réel** — barème = configuration/référence,
  jamais un appel de fonds, même limite que `PricingConfig`/
  `LegalPaymentTierTemplate`/`ProgramCost`.
- **Câblage avec `apps.procurement`/un futur grand-livre par lot** — ce ticket
  construit le barème et sa lecture SEULS ; B-035/B-036 (déjà annoncés par
  l'utilisateur) devront les CONSOMMER via `get_active_control_office_rate`,
  jamais dupliquer la logique de dérivation.
- **Validation de `jalon_type` contre `MilestoneTemplateStep`** — couplage
  explicitement écarté (vérification préalable ci-dessus).

## Critères d'acceptation

- [x] `admin_keyimmo` peut créer une entrée de barème avec `calculation_mode
      = percentage` (`percentage` renseigné, `fixed_amount` absent) ; tout
      autre rôle → 403.
- [x] `admin_keyimmo` peut créer une entrée avec `calculation_mode =
      fixed_amount` (`fixed_amount` renseigné, `percentage` absent).
- [x] Une entrée avec les DEUX valeurs renseignées, ou AUCUNE des deux pour le
      mode choisi, est refusée AVANT toute écriture (400, aucune ligne créée)
      — testé au niveau service ET par une tentative SQL brute qui violerait
      le `CheckConstraint` (preuve que la garantie est réellement en base, pas
      seulement applicative).
- [x] Un `country_pack_id` inactif est refusé explicitement
      (`CountryPackInactiveError`, 409) — testé avec un `CountryPack` inactif
      créé pour l'occasion.
- [x] `GET .../current/` renvoie la DERNIÈRE entrée pour un
      `(country_pack, jalon_type)` donné (`LATEST_FIRST_ORDERING`).
- [x] `GET .../history/` renvoie l'historique complet, chronologique.
- [x] `ControlOfficeRate` est immuable après création — aucune policy RLS
      `UPDATE`/`DELETE`, testée comme une tentative EXPLICITE refusée (SQL
      brut, `rowcount == 0`), pas seulement une absence de route ; aucune
      fonction `update`/`delete` dans `services.py` (`hasattr`).
- [x] Test de collision FORCÉE sur `sequence` (même méthode que B-031/B-033 :
      `timezone.now` gelé sur deux créations séparées) — prouve le tie-break
      dès la conception, pas un espoir de reproduction hasardeuse.
- [x] Garde par test : aucune fonction de service ailleurs dans le projet
      n'expose de mécanisme alternatif de calcul/saisie d'un montant bureau
      de contrôle (décision D).
- [x] Note `CLAUDE.md` nommant explicitement B-035/B-036 et
      `get_active_control_office_rate` (décision D, précision explicite de
      l'utilisateur) — pas une formule générique.
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits
      avant de considérer le ticket terminé.

## Notes d'implémentation

**`sequence`/`LATEST_FIRST_ORDERING` réutilisés directement, sans
duplication** — `LATEST_FIRST_ORDERING = ('-created_at', '-sequence')`
(module `apps/pricing/services.py`) est un tuple générique déjà utilisé pour
`PricingConfig` ; comme `ControlOfficeRate` porte les MÊMES noms de champs
(`created_at`/`sequence`), la même constante s'applique telle quelle, aucun
second tuple créé pour ce modèle.

**Test de collision forcée plus simple que celui de `ProgramCost`
(ticket B-033)** — `create_control_office_rate` n'appelle jamais
`set_rls_context` (décision F : pas de bascule RLS, donnée de référence par
pays comme `PricingConfig`, pas par organisation comme `ProgramCost`) : la
transaction implicite standard de `@pytest.mark.django_db` suffit, pas besoin
du `django_db(transaction=True)` + `transaction.atomic()` explicite requis
pour B-033. Repris du test équivalent de `PricingConfig` (ticket B-031),
présent plus haut dans le même fichier.

**Garde « seule source de vérité » (décision D)** — implémentée comme un
balayage de TOUS les modules `apps.*.services` du projet (`pkgutil.
walk_packages`) à la recherche de noms de fonction suspects
(`create_control_office_amount`, `set_bc_amount`, etc.), pas un scan AST du
code source (contrairement aux gardes `TestNoDirectTrustEventOrderingOutsideRepository`/
`TestNoDirectPricingConfigOrderingOutsideServices`, tickets 013 bis/B-031) —
suffisant ici puisqu'aucun autre code ne calcule encore de montant BC
aujourd'hui. La note `CLAUDE.md` reste la protection principale pour les
tickets consommateurs futurs (B-035/B-036) ; cette garde n'attrape qu'un
nommage de fonction malencontreux, pas une réimplémentation sous un autre
nom.

**Deux tests SQL bruts distincts pour la garantie B** — un test au niveau
service (`percentage`/`fixed_amount` tous deux renseignés → 400 applicatif)
ET un test d'INSERT SQL brut violant directement le `CheckConstraint`
(`IntegrityError`, hors de toute validation Django) — preuve que la
garantie tient même en contournant complètement la couche applicative.

**Suite de tests** : 18 tests dédiés (création — 2 modes valides,
permissions, 4 cas de rejet dont `CountryPack` inactif —, contrainte
`CheckConstraint` en SQL brut, current/history, immutabilité RLS complète,
garde de source unique, collision forcée de `sequence`). Suite `pricing`
complète : 56 tests. Suite `procurement` (test-garde exhaustif des routes) :
54 tests. Suite complète du projet (base de cette branche, avant fusion de
B-033) : 303 tests, tous verts.

**Piège opérationnel rencontré en documentant ce ticket, sans lien avec le
code** : lancer deux suites de tests complètes en parallèle depuis deux
worktrees différents (celui-ci et celui de B-033) contre la même base de
données de test partagée (`test_keya_ecosystem_db`) a provoqué des
collisions de cycle de vie (créations/destructions concurrentes) — de
nombreux faux échecs sans rapport avec le code des deux tickets, corrigés en
relançant chaque suite en isolation. Aucune suite de tests de ce projet ne
doit plus être lancée en parallèle d'une autre depuis une session
différente.
