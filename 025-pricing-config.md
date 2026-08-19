# Ticket 025 — PricingConfig (section 14ter du modèle économique)

## Statut

**Livré.** Backend/API uniquement (aucune interface utilisateur, comme prévu).
12/12 tests `apps/pricing` verts. Le document « modèle économique » cité (section
14ter) n'a jamais été retrouvé sur cette machine — ce ticket s'appuie uniquement sur
la description donnée dans la demande initiale.

## Décisions de conception actées

**A. Nouvelle app `apps/pricing`, distincte** — pas une extension d'`apps/organizations`
(qui possède déjà `CountryPack`). Ce ticket introduit une logique métier propre
(historique, garde d'immutabilité) qui justifie son propre domaine, cohérent avec « un
nouveau domaine métier = une nouvelle app » (CLAUDE.md, section Structure).

**B. Lecture des taux réservée à `admin_keyimmo`** — même principe que les montants de
devis (ticket 022) : le barème de configuration brut (taux de marge/commission) n'est
JAMAIS exposé à un autre rôle. Le résultat appliqué (le montant d'un `Devis` verrouillé,
déjà couvert par le ticket 022) reste la seule chose visible côté client — pas le
barème lui-même. Contrairement au ticket 022, où deux serializers coexistent
(admin/candidat) pour la MÊME ressource, `PricingConfig` n'a ICI qu'une seule audience
(`admin_keyimmo`) — aucune vue candidate à construire, la garde de confidentialité se
réduit à une vérification de permission directe (403 pour tout autre rôle), pas un
balayage anti-fuite multi-endpoints comme le ticket 022 (une seule ressource, un seul
serializer, rien d'autre à couvrir).

**C. Immutabilité RLS en base, même rigueur que `Devis`/`TrustEvent`** — pas une simple
discipline applicative comme `CountryPack`/`Organization`/`Role` (aucune policy RLS
aujourd'hui, vérifié). Justifié explicitement par l'utilisateur : un taux de marge mal
modifié affecte silencieusement tous les devis créés après le changement — le niveau de
protection le plus élevé du projet est justifié. `PricingConfig` n'a pas de colonne
`organization_id` naturelle (rattaché à `CountryPack`, pas à une organisation) : policy
`SELECT`/`INSERT` permissive (`USING (true)` / `WITH CHECK (true)`), **aucune policy
`UPDATE`/`DELETE`** — sous `FORCE ROW LEVEL SECURITY`, ceci bloque ces deux commandes
par défaut, même mécanisme que `procurement_devis` (ticket 022). La restriction de
LECTURE à `admin_keyimmo` (point B) reste une permission DRF (`IsAdminKeyimmo`), jamais
une policy RLS — division déjà établie dans ce projet : RLS protège la frontière
organisationnelle/l'immutabilité, les permissions DRF protègent le rôle (ex.
`IsConstructeur`, `IsInspecteur`).

**Scope — 025 (stockage/audit) séparé de 026 (câblage `Devis.marge_estimee`)** :
confirmé. Ce ticket ne touche à AUCUN fichier d'`apps/procurement` — la question de
savoir si/comment `PricingConfig` pré-remplit `marge_estimee` à la création d'un
`Devis` est un futur ticket 026 séparé, une fois ce point explicitement demandé (même
discipline que ticket 009 → ticket 022 : poser la brique sans câbler la consommation
avant qu'elle soit explicitement demandée).

## Objectif

Configuration versionnée de deux taux — marge (**canal 1**) et commission (**canal
2**) —, rattachée à un `CountryPack`, avec un historique auditable complet (qui, quand,
taux). Aucun `UPDATE` en base, jamais : un changement de taux est un NOUVEL
enregistrement.

## Dépendances

- **Ticket 001** (`CountryPack`) — `PricingConfig` s'y rattache.
- **Ticket 003** (`TrustEvent` append-only) — modèle de rigueur pour la garde
  d'immutabilité (RLS sans policy `UPDATE`/`DELETE`), pas un `TrustEvent` lui-même
  (`PricingConfig` n'est pas un fait sur un objet métier inspecté, c'est une
  configuration système — domaine distinct, doctrine Visible Trust appliquée par
  ANALOGIE de rigueur, pas par réutilisation directe de `apps.trust`).
- **Ticket 011** (`IsAdminKeyimmo`) — réutilisée telle quelle, import direct depuis
  `apps.backoffice.permissions`, jamais dupliquée.

## Entités touchées

Nouvelle app `apps/pricing` (label `pricing`).

**`PricingConfig`** :
- `id` (UUID)
- `country_pack` (FK `CountryPack`, `PROTECT`)
- `canal` (`TextChoices` : `canal_1_marge` / `canal_2_commission` — vocabulaire de
  doctrine fixe, comme `TrustLevel`/`TaskType`, jamais une configuration `CountryPack`)
- `rate` (`DecimalField(max_digits=5, decimal_places=2)` — taux en pourcentage, ex.
  `12.50`)
- `created_by` (FK `User`, `PROTECT`)
- `created_at` (auto)

Aucun champ `is_active` ni `previous_rate` : le taux ACTUEL pour un `(country_pack,
canal)` est le dernier enregistrement (`-created_at`), dérivé, jamais stocké
séparément (doctrine Visible Trust) ; l'« ancien taux » de tout changement se lit dans
l'historique complet (l'enregistrement précédent), jamais dupliqué en champ dédié.

**Pas de colonne `sequence`** (contrairement à `TrustEvent`, ticket 013 bis) : le piège
tie-break de `TrustEvent` vient de deux événements créés dans la MÊME transaction, sans
commit intermédiaire (`_advance_existing_reserve`, qui enchaîne deux créations). Rien
d'équivalent ici — `create_pricing_config` ne crée jamais qu'UN SEUL enregistrement par
appel, jamais deux dans la même transaction. `-created_at` seul suffit à dériver le
dernier taux sans ambiguïté.

## Scope inclus

- `PricingConfig` + migration + RLS (`SELECT`/`INSERT` permissifs, aucune policy
  `UPDATE`/`DELETE`).
- `POST /api/pricing/configs/` (`admin_keyimmo` uniquement) — crée un NOUVEAU
  `PricingConfig`. Aucun endpoint `PUT`/`PATCH`/`DELETE` n'existe, nulle part.
- `GET /api/pricing/configs/current/?country_pack_id=<id>` (`admin_keyimmo`
  uniquement) — taux ACTUELS des deux canaux pour ce `CountryPack` (dernier
  enregistrement par canal, `None` si aucun n'existe encore pour l'un des deux).
- `GET /api/pricing/configs/history/?country_pack_id=<id>&canal=<canal>`
  (`admin_keyimmo` uniquement) — historique complet ordonné (plus ancien en premier)
  pour CE couple `(country_pack, canal)` — qui, quand, taux.

## Explicitement hors scope

- **Câblage avec `Devis.marge_estimee`** (pré-remplissage automatique à la création
  d'un devis) — ticket 026 séparé, une fois demandé explicitement.
- **Toute consommation réelle des taux** (appliquer une commission à une transaction) —
  aucun module de paiement n'existe dans ce projet à ce jour (voir
  `docs/gate3-classement-angles-morts.md`, item 1 : RESEARCH REQUIRED).
- **Toute UI** — backend/API uniquement, comme les tickets précédents de cette série.
- **Lecture candidate/constructeur des taux** — décision B, aucune vue de ce type.

## Critères d'acceptation

- [x] `admin_keyimmo` peut créer un `PricingConfig` (`country_pack`, `canal`, `rate`) ;
      tout autre rôle → 403.
- [x] Un second `PricingConfig` créé pour le MÊME `(country_pack, canal)` ne modifie ni
      ne supprime le précédent — les deux coexistent, distincts.
- [x] `GET .../current/` renvoie le DERNIER taux créé pour chaque canal — testé après
      au moins deux créations successives sur le même canal, la première ne doit plus
      apparaître comme « actuelle ».
- [x] `GET .../history/` renvoie TOUS les enregistrements d'un `(country_pack, canal)`,
      ordonnés, avec `created_by`/`created_at`/`rate` pour chacun — l'« ancien taux »
      d'un changement donné se lit en comparant deux entrées consécutives.
- [x] `GET .../current/` et `GET .../history/` : tout rôle autre que `admin_keyimmo` →
      403 (aucune fuite du barème, décision B).
- [x] **Immutabilité, même rigueur que l'append-only `TrustEvent`/`Devis`** (tickets
      003/022) : tentative directe d'`UPDATE` en SQL brut sur `pricing_pricingconfig`
      (hors ORM), `cursor.rowcount == 0` attendu, `rate` inchangé après relecture ;
      même test pour `DELETE`.
- [x] Aucun endpoint `PUT`/`PATCH`/`DELETE` n'existe sur `PricingConfig`, nulle part
      (vérifié par la liste EXACTE des routes du module, même garde que les tickets
      précédents).
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits avant de
      considérer le ticket terminé.

## Notes d'implémentation

**Fichiers livrés** : nouvelle app `apps/pricing` — `models.py` (`PricingCanal`,
`PricingConfig`), `services.py` (`create_pricing_config`, `get_current_rates`,
`get_pricing_history`), `serializers.py`, `views.py` (3 vues), `urls.py`, migrations
`0001_initial.py` + `0002_pricingconfig_rls.py`, `tests.py` (12 tests). Enregistrée
dans `INSTALLED_APPS`/`config/urls.py`. Aucun fichier `apps/procurement` touché,
conforme au scope 025/026.

**Collision de nom évitée consciemment** : la classe `AppConfig` de Django pour cette
app aurait dû s'appeler `PricingConfig` par la convention `<Nom>Config` déjà suivie
(`ProcurementConfig`, `InspectionsConfig`...) — collision directe avec le modèle
métier `PricingConfig`, qui porte délibérément ce nom (celui du ticket). Renommée
`PricingAppConfig` (`apps/pricing/apps.py`), avec la raison documentée en docstring —
seule déviation de convention de ce ticket, jamais silencieuse.

**Effet de bord attendu, corrigé consciemment** : le test de garde exhaustif du
ticket 022 (`apps/procurement/tests.py::
TestDevisAmountNeverLeaksToConstructeurRole::
test_all_registered_get_api_routes_match_the_documented_list`, qui suit TOUTES les
routes GET du projet, pas seulement celles de son propre module) a échoué dès le
premier lancement de la suite complète — exactement son rôle : forcer une décision
consciente sur les 3 nouvelles routes `pricing-config-*`. Mise à jour en conséquence
(routes ajoutées à la liste attendue, commentaire expliquant pourquoi), pas
neutralisée.

**Garde d'immutabilité vérifiée en trois couches, comme demandé explicitement
(« tentative explicite refusée, pas seulement absence de route »)** :
1. HTTP : `PUT`/`PATCH`/`DELETE` sur l'endpoint de création → 405 (la vue ne définit
   que `post`).
2. SQL brut : `UPDATE`/`DELETE` directs sur `pricing_pricingconfig`, hors ORM →
   `cursor.rowcount == 0`, aucune exception levée (RLS bloque silencieusement, comme
   `TrustEvent`/`Devis`) — donnée relue et confirmée inchangée après coup.
3. Applicative : aucune fonction `update_pricing_config`/`delete_pricing_config`
   n'existe dans `services.py` (`hasattr`), même famille que `apps.trust.repository`.

Complétée par un test de la liste EXACTE des routes du module (`urls.py`) — toute
route future ajoutée sans mise à jour consciente de ce test le fait échouer, même
famille de garde que les modules précédents.

**Pas de trigger `BEFORE UPDATE/DELETE` au niveau DB** (contrairement à `TrustEvent`,
qui en a un EN PLUS de l'absence de policy RLS, ticket 003) : ce troisième filet de
`TrustEvent` protège contre un contournement DEPUIS Django lui-même (une policy RLS
ajoutée par erreur dans une migration future). `PricingConfig` n'a qu'un seul filet
RLS ici, jugé suffisant — aucune fonction `update`/`delete` n'existe côté service
(layer applicatif déjà par construction, rien à contourner), et le risque d'ajout
accidentel d'une policy `UPDATE` future reste identique à `Devis` (ticket 022, un seul
filet RLS lui aussi, pas de trigger) plutôt qu'à `TrustEvent` (trois filets, table la
plus critique du projet).

**Suite** : `apps/pricing` — 12/12 tests verts. Suite backend complète relancée après
implémentation pour confirmer l'absence de régression ailleurs — voir résultat
rapporté à l'utilisateur.
