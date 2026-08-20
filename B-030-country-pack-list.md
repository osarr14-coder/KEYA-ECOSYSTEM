# Ticket B-030 — Liste des `CountryPack`

## Statut

**Implémenté, testé (5 tests dédiés, suite complète 280 tests verte), documenté —
en attente du feu vert utilisateur pour fusion vers `master`.** Conception tranchée
avec l'utilisateur (points A/B), même discipline que les tickets
012/024/025/026/B-027/B-028/B-029 : décisions actées avant d'écrire le code, pas
après.

## Origine

Découvert par la session frontend en préparant F-028 (écran de tarification admin) :
les trois endpoints `PricingConfig` (ticket 025) et les endpoints
`LegalPaymentTierTemplate` (ticket B-027) exigent tous un `country_pack_id`, mais
aucun endpoint n'expose la liste des `CountryPack` existants pour construire un
sélecteur. `apps/organizations/urls.py` n'existe toujours pas — vérifié avant
rédaction (recherche exhaustive `CountryPack` dans tous les `views.py`/`urls.py`
du projet, aucune occurrence) : `apps/organizations/views.py` est encore le stub
Django par défaut, jamais utilisé.

## Décisions de conception actées

**A. Filtre `is_active=True` — comportement NOUVEAU dans ce projet, voulu, pas un
oubli.** `CountryPack.is_active` existe sur le modèle depuis le ticket 001 mais
n'est filtré NULLE PART ailleurs aujourd'hui — les deux seules lectures
existantes (`apps/pricing/services.py::create_pricing_config`/
`create_legal_payment_tier_template`) résolvent un `CountryPack` par `id`
uniquement, sans jamais vérifier son statut. Ce ticket introduit donc le PREMIER
usage réel de ce champ. Décision : un sélecteur destiné à préparer la création de
taux (`PricingConfig`)/paliers légaux (`LegalPaymentTierTemplate`) réels ne doit
jamais proposer un pays qui n'a pas encore été activé.

**Point de vigilance explicitement noté, PAS corrigé dans ce ticket** : les deux
fonctions de service citées ci-dessus (création de `PricingConfig`/
`LegalPaymentTierTemplate`) ne vérifient elles-mêmes AUCUN statut `is_active` —
un `admin_keyimmo` qui soumettrait directement un `country_pack_id` inactif
(deviné, ou copié d'un autre contexte) pourrait donc contourner le filtre de CE
endpoint de liste et créer un taux/palier pour un pays non activé malgré tout. Ce
ticket ne construit qu'un sélecteur, pas une garde de validation — candidat
explicite pour un futur ticket de durcissement (vérifier `is_active` DANS
`create_pricing_config`/`create_legal_payment_tier_template` elles-mêmes, pas
seulement à la lecture de la liste).

**B. Réponse `{id, label, code}`, pas seulement `{id, label}`.** Écart volontaire
par rapport au scope initialement décrit — `code` (ex. `'SN'`) existe déjà sur le
modèle, coût nul à exposer, utile pour un affichage du type « Sénégal (SN) » côté
sélecteur frontend.

## Vérification préalable — aucun endpoint similaire n'existe déjà

Recherche exhaustive (`grep -rl "CountryPack" apps/*/views.py apps/*/urls.py`) :
aucune occurrence dans tout le projet. `apps/organizations/views.py` est encore
`# Create your views here.` (stub par défaut, jamais modifié depuis sa création).
`apps/organizations/urls.py` n'existe pas — ce ticket le crée, et l'ajoute à
`config/urls.py` (même schéma d'inclusion que les 10 autres apps déjà montées,
`path('api/', include('apps.organizations.urls'))`).

## Entités touchées

Aucune nouvelle table, aucune migration de schéma — uniquement de nouveaux
fichiers/ajouts dans `apps/organizations` (`views.py`, nouveau `urls.py`,
`serializers.py`) et un ajout à `config/urls.py`.

## Scope inclus

- `GET /api/organizations/country-packs/` (`admin_keyimmo` uniquement, même
  permission `IsAdminKeyimmo` que `PricingConfig`/`LegalPaymentTierTemplate`,
  cohérence avec le reste de la configuration économique) — retourne TOUS les
  `CountryPack` où `is_active=True` (décision A), triés par `label`
  (alphabétique, lisible pour un sélecteur). Forme de chaque élément :
  `{id, label, code}` (décision B).
- Pas de recherche filtrée (`?q=`) — volume attendu structurellement faible
  (quelques pays au maximum), une simple liste complète suffit, contrairement à
  B-028/ticket 011 (lots/organisations/utilisateurs, volume potentiellement
  élevé).
- `apps/organizations/urls.py` (nouveau fichier) + ajout à `config/urls.py`.

## Explicitement hors scope

- **Aucune vérification `is_active` ajoutée à `create_pricing_config`/
  `create_legal_payment_tier_template`** (décision A, point de vigilance) —
  candidat pour un futur ticket de durcissement, pas construit ici.
- **Aucune écriture** — endpoint strictement `GET`.
- **Aucun autre champ du modèle `CountryPack`** au-delà de `id`/`label`/`code` —
  `is_active` lui-même n'est PAS exposé dans la réponse (implicite : tout élément
  listé EST actif, par construction du filtre).
- **Toute UI** — le frontend (session F-028) consomme cet endpoint séparément.

## Critères d'acceptation

- [x] `admin_keyimmo` peut lister les `CountryPack` ; tout autre rôle → 403.
- [x] Seuls les `CountryPack` avec `is_active=True` apparaissent dans la réponse
      — testé explicitement avec un `CountryPack` inactif créé pour l'occasion,
      absent de la réponse.
- [x] Chaque élément de la réponse a exactement la forme `{id, label, code}`.
- [x] La réponse est triée par `label`.
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits avant de
      considérer le ticket terminé.

## Notes d'implémentation

**Erreur d'édition trouvée et corrigée avant de lancer la suite, même famille que
celle déjà rencontrée au ticket B-028** : l'insertion de `TestCountryPackList` a
d'abord laissé orpheline la 3ᵉ assertion (`assert senegal.is_active is True`) du
seul test préexistant du fichier (`test_country_pack_senegal_exists_as_seeded_data`)
— une lecture partielle du fichier (limite de lignes de l'outil de lecture)
n'avait montré que les deux premières assertions de ce test. Détecté
immédiatement par une `NameError` à la collection des tests (pas même une
exécution), jamais par relecture silencieuse. Corrigé en restaurant la troisième
assertion dans son test d'origine et en supprimant la ligne orpheline. Aucune
perte de couverture.

**`apps/organizations` gagne sa première route de ce projet** — `views.py` était
encore le stub Django par défaut, `urls.py` n'existait pas. Créé et câblé dans
`config/urls.py` selon le même schéma que les 10 autres apps déjà montées
(`path('api/', include('apps.organizations.urls'))`).

**Suite de tests** : 5 tests dédiés (`TestCountryPackList` : liste, exclusion
`is_active=False`, permission, tri, forme exacte de la réponse). Test-garde
exhaustif des routes (`apps/procurement/tests.py::
test_all_registered_get_api_routes_match_the_documented_list`) mis à jour
consciemment avec `country-pack-list`. Suite `organizations` : 10 tests. Suite
`procurement` : 54 tests (inchangée en nombre, juste la liste `expected` mise à
jour). Suite complète du projet : 280 tests, tous verts.
