# Ticket B-029 — Noms lisibles sur `DevisAdminSerializer`

## Statut

**Implémenté, testé (5 tests dédiés, suite complète 275 tests verte), documenté —
en attente du feu vert utilisateur pour fusion vers `master`.** Conception tranchée
avec l'utilisateur (points A/B/C/D), même discipline que les tickets
012/024/025/026/B-027/B-028 : décisions actées avant d'écrire le code, pas après.

## Origine

Ticket de suivi direct de B-028 : `DevisAdminSerializer` (`apps/procurement`)
expose `organization`/`lot`/`candidate_organization` comme des UUID bruts, jamais
résolus en noms lisibles — contrairement aux deux endpoints de recherche de
B-028 (`GET /api/procurement/admin/lots/?q=`/`GET /api/procurement/admin/
organizations/?q=`), qui renvoient déjà `{id, name}`. Demande explicite de
l'utilisateur : étendre `DevisAdminSerializer` avec les noms (lot, organisation,
organisation candidate, programme parent du lot), sur le même format que la
réponse de recherche.

## Vérification préalable — aucune fuite possible par construction

`DevisAdminSerializer` est utilisé à exactement 3 endroits dans tout le projet
(vérifié par recherche exhaustive avant conception, pas supposé) :
`DevisCreateView.post`, `DevisLockView.post`, `DevisAdminListView.get` — les
TROIS réservés à `admin_keyimmo` (`IsAdminKeyimmo`). `DevisCandidateSerializer`
n'hérite délibérément PAS de `DevisAdminSerializer` (décision de conception
actée au ticket 022, déjà documentée dans son propre docstring) — une liste
`fields` EXPLICITE et positive, jamais une exclusion. Ajouter des champs à
`DevisAdminSerializer` ne peut donc, par construction, atteindre aucun autre
rôle — vérifié une seconde fois après implémentation par une assertion
explicite dans le test-garde existant (`TestDevisAmountNeverLeaksToConstructeurRole`,
voir critères d'acceptation), même discipline que le reste de ce test : prouver,
pas seulement présumer de la structure.

## Décisions de conception actées

**A. Champs ADDITIFS, jamais un remplacement.** Les champs UUID bruts existants
(`organization`, `candidate_organization`, `lot`, `logged_by`) restent
INCHANGÉS — aucun champ retiré, aucun type modifié. Vérifié avant cette décision :
`apps/web/src/api/types.ts` (ligne 78-79) mirror `DevisAdminSerializer` avec
`organization: string`/`candidate_organization: string` (UUID brut), et
`DevisLockView`/`DevisAjustementView` attendent `organization` comme UUID BRUT
dans leur corps de requête — un remplacement par un objet imbriqué casserait
silencieusement tout code frontend qui recopie ces champs tels quels vers une
requête suivante. Nouveaux champs ajoutés : `lot_detail`, `candidate_organization_detail`.

**B. Réutilisation LITTÉRALE des serializers du ticket B-028**, pas une
duplication de forme :
- `lot_detail` = `LotSearchResultSerializer(devis.lot).data` — exactement
  `{id, name, organization: {id, name}, program: {id, name}}`, la même classe
  que celle qui sert `GET /api/procurement/admin/lots/?q=`.
- `candidate_organization_detail` =
  `OrganizationSearchResultSerializer(devis.candidate_organization).data` —
  exactement `{id, name}`, la même classe que celle qui sert
  `GET /api/procurement/admin/organizations/?q=`.

**C. Pas de champ `organization_detail` séparé.** `Devis.organization` vaut
TOUJOURS l'organisation du lot, par construction (docstring du modèle,
ticket 022 : « organization = organisation du LOT, PAS celle du candidat ») —
donc structurellement identique à `Devis.lot.organization` en toute
circonstance. Un `organization_detail` dupliquerait exactement
`lot_detail.organization` sans apporter d'information supplémentaire —
`lot_detail.organization` suffit.

**D. Vérification de non-fuite EXPLICITE, pas seulement structurelle.** Un test
ajouté à `TestDevisAmountNeverLeaksToConstructeurRole` confirme que
`lot_detail`/`candidate_organization_detail` sont absents de toute réponse
`DevisCandidateSerializer` (candidat) — déjà garanti par l'absence d'héritage,
mais prouvé plutôt que supposé, même discipline que le reste de ce test
(balayage large de tous les endpoints déjà accessibles au rôle constructeur).

## Entités touchées

Aucune nouvelle table, aucune migration — uniquement `apps/procurement/
serializers.py::DevisAdminSerializer` (extension) et, potentiellement,
`select_related`/`prefetch_related` sur les requêtes qui alimentent
`DevisAdminListView` pour éviter un N+1 inutile (plusieurs devis d'un même lot
partagent le même `lot`/`organization` — un seul `select_related` suffit,
pas une requête par devis).

## Scope inclus

- `DevisAdminSerializer` gagne deux champs `SerializerMethodField` :
  `lot_detail` (réutilise `LotSearchResultSerializer`, décision B) et
  `candidate_organization_detail` (réutilise `OrganizationSearchResultSerializer`,
  décision B).
- Les 3 endpoints existants qui utilisent ce serializer
  (`DevisCreateView`/`DevisLockView`/`DevisAdminListView`) exposent
  automatiquement ces deux nouveaux champs, sans changement de leur propre
  code (aucune vue à modifier, seul le serializer change).
- `select_related('lot__organization', 'lot__asset__program', 'candidate_organization')`
  ajouté partout où `Devis`/une liste de `Devis` est chargée avant sérialisation
  par ce serializer, pour éviter un N+1 par ligne.

## Explicitement hors scope

- **Aucun changement de `DevisCandidateSerializer`** — la vue candidat ne
  gagne aucun champ, décision de conception 2 du ticket 022 (aucun montant
  NI aucune autre donnée additionnelle exposée à ce rôle dans ce ticket).
- **Aucun changement des serializers d'entrée** (`DevisCreateSerializer`/
  `DevisAjustementCreateSerializer`) — toujours des UUID bruts en entrée,
  décision A.
- **`organization_detail`** — décision C, pas construit.
- **Toute UI** — le frontend (session F-027/F-028) consomme ces champs
  séparément, une fois ce ticket fusionné.

## Critères d'acceptation

- [x] Une réponse `DevisAdminSerializer` (sur les 3 endpoints existants)
      contient `lot_detail` avec exactement la forme `{id, name, organization:
      {id, name}, program: {id, name}}`, valeurs correctes (pas de fuite d'un
      autre lot/organisation/programme).
- [x] Une réponse `DevisAdminSerializer` contient `candidate_organization_detail`
      avec exactement la forme `{id, name}`, valeur correcte.
- [x] Les champs UUID bruts existants (`organization`, `candidate_organization`,
      `lot`, `logged_by`) restent PRÉSENTS et INCHANGÉS (même type, même valeur)
      — testé explicitement, pas seulement absence de régression accidentelle.
- [x] `lot_detail`/`candidate_organization_detail` sont ABSENTS d'une réponse
      `DevisCandidateSerializer` (candidat) — testé explicitement dans
      `TestDevisAmountNeverLeaksToConstructeurRole` (décision D).
- [x] Aucune régression sur le test-garde exhaustif des routes (aucune route
      nouvelle dans ce ticket — confirmé, ce test n'a pas eu besoin d'être
      touché).
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits avant
      de considérer le ticket terminé.

## Notes d'implémentation

**Bug réel trouvé au premier lancement des tests — même classe que le bug déjà
documenté pour `get_status` au ticket 022.** La première implémentation de
`get_lot_detail` accédait directement à `obj.lot.asset.program` depuis le
serializer. `DevisCreateView`/`DevisLockView` restaurent le contexte RLS vers
l'organisation de l'ADMIN avant que la vue ne sérialise sa réponse (comme
`create_devis`/`lock_devis` l'ont toujours fait) : `obj.lot` restait accessible
(déjà mis en cache par le service au moment de la création/du verrouillage), mais
`obj.lot.asset`/`.asset.program` — jamais chargés jusque-là — déclenchaient une
requête FRAÎCHE sous le MAUVAIS contexte RLS (`programs_lot`/`programs_asset`/
`programs_program` sont sous `FORCE ROW LEVEL SECURITY`, migration
`0002_programs_rls.py`), échouant en `Asset.DoesNotExist`. 8 tests ont échoué dès
la première exécution de la suite `procurement` (`TestDevisCreation`,
`TestDevisLock`, `TestPricingConfigWiring`, et les 3 nouveaux tests B-029 qui
appellent ces mêmes endpoints) — jamais découvert par relecture, exactement le
comportement recherché par la discipline de test de ce projet.

Corrigé en déplaçant la résolution dans la couche service, deux nouvelles
fonctions (`get_devis_lot_detail`/`get_devis_candidate_organization_detail`,
`apps/procurement/services.py`) qui reprennent EXACTEMENT le schéma de
`get_devis_status` (ticket 022) : bascule vers `devis.organization_id`, lecture,
restauration vers `restore_organization_id` dans un `finally`. Le serializer
n'accède plus jamais directement à `obj.lot`/`obj.candidate_organization` — il
délègue systématiquement au service, même discipline que `get_status` déjà en
place. Import différé (niveau fonction) de `.serializers` depuis `services.py`
pour éviter un import circulaire (`serializers.py` importe déjà `services` au
niveau module).

**`DevisAdminListView` non affectée par ce bug** : `list_devis_for_lot_as_admin`
charge déjà `lot__organization`/`lot__asset__program` via `select_related`
PENDANT sa propre bascule RLS (ajouté dans ce même ticket, voir « Scope inclus »)
— la bascule supplémentaire posée par `get_devis_lot_detail` pour CE chemin ne
coûte que deux appels `set_config` inoffensifs, aucune requête SQL
supplémentaire (les attributs sont déjà en cache).

**Suite de tests** : 5 tests dédiés (`TestDevisAdminSerializerNames` : création,
verrouillage, liste, absence de `organization_detail` séparé ; plus une
assertion de non-fuite ajoutée à `TestDevisAmountNeverLeaksToConstructeurRole`).
Suite `procurement` complète : 54 tests. Suite complète du projet : 275 tests,
tous verts.
