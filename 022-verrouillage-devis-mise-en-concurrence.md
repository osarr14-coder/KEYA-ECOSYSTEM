# Ticket 022 — Verrouillage de devis / mise en concurrence

## Statut
Livré. Backend/API uniquement (aucune interface utilisateur, comme prévu). Nouvelle
app `apps/procurement`, 18/18 tests verts.

## Décisions de conception (validées par l'utilisateur avant implémentation)

Même discipline que le ticket 012 (« Trois décisions de conception, validées par
l'utilisateur avant implémentation ») — deux décisions structurantes tranchées ici
avant d'écrire le moindre code.

1. **Création du `Devis` exclusive à `admin_keyimmo`, aucun endpoint d'écriture pour
   le rôle constructeur candidat** — reproduit exactement le pattern déjà établi pour
   `InspectionMission` (ticket 012, section « Affectation de mission à un
   inspecteur », CLAUDE.md). Le staff KEYIMMO saisit chaque devis reçu (collecté hors
   plateforme — même canal que la messagerie tracée du ticket 011 le permettrait déjà
   pour les échanges, mais la saisie du montant lui-même reste un geste administratif
   explicite, jamais un formulaire candidat). Justification retenue : point de
   contrôle humain sur une étape sensible, et surtout — conséquence directe de cette
   décision — la garde anti-fuite de montants (voir plus bas) est radicalement
   simplifiée : aucun endpoint d'écriture ni de lecture accessible au rôle
   constructeur ne manipule jamais de montant, sans cas particulier à distinguer.
2. **Aucun montant n'est jamais exposé au rôle constructeur, y compris le sien** — ne
   se pose plus vraiment comme un choix indépendant une fois la décision 1 actée
   (aucun candidat ne soumet directement son propre montant, donc pas de « mon
   montant à moi » à distinguer de « celui des autres »). Tout accès à un montant
   passe exclusivement par `admin_keyimmo`, cohérent avec KEYIMMO comme intermédiaire
   de confiance (voir le modèle de séquestre discuté pour le classement Gate 3,
   `docs/gate3-classement-angles-morts.md` — même logique d'intermédiation, un
   parallèle utile mais **pas une dépendance fonctionnelle réelle** entre les deux
   sujets).

## Note de conception — un seul modèle `Devis`, fusion volontaire avec la notion de
## candidature

Question posée avant implémentation : le modèle `Devis` unique (une ligne par
COUPLE lot/organisation candidate, `candidate_organization`) fusionne-t-il à tort
« devis verrouillé » (LE devis retenu, un seul par lot) et « candidature/appel
d'offres » (PLUSIEURS par lot, une par candidat) ?

**Réponse : ce n'est pas une perte de distinction — les deux concepts existent déjà
séparément dans ce modèle, juste pas comme deux TABLES distinctes :**

- **Plusieurs lignes `Devis` par lot** (une par organisation candidate) = les
  candidatures. Rien dans le modèle ne limite un lot à un seul `Devis` — c'est
  précisément la mise en concurrence : `Devis.objects.filter(lot=...)` EST la liste
  des candidatures.
- **Le verrouillage** (un `TrustEvent` `devis_verrouille` sur UNE de ces lignes) EST
  ce qui distingue la candidature retenue des autres — exactement le même
  raisonnement que `Reserve`/`InspectionMission` : le statut (« candidat » vs
  « verrouillé ») se DÉRIVE, il n'est pas porté par une table séparée.

**Pourquoi une seule table plutôt que `Candidature` (légère) + `Devis` (le montant,
FK vers `Candidature`) séparées** — fusion volontaire, pas un oubli : dans le
périmètre de ce ticket (décision de conception 1), la candidature et son montant
naissent dans le MÊME geste administratif, par le MÊME acteur (`admin_keyimmo` saisit
un devis déjà reçu, montant inclus — il n'existe aucun flux où une organisation
« candidate sans montant encore connu » aurait besoin d'exister comme état
intermédiaire dans CE système : ce cas se gère hors plateforme, avant la saisie).
Séparer les deux tables ajouterait une distinction sans aucun consommateur réel dans
ce ticket — exactement le genre de sur-ingénierie que CLAUDE.md/les instructions de
travail déconseillent (« ne pas designer pour des besoins hypothétiques »).

**Ce qui ferait légitimement remettre cette fusion en question, plus tard** (à
surveiller, pas à anticiper maintenant) : si un futur ticket a besoin de représenter
une candidature SANS montant connu (ex. un vrai flux de candidature en ligne où le
candidat s'inscrit avant de chiffrer), ou plusieurs montants successifs pour une
même candidature (renégociation — explicitement hors scope ici, voir plus haut). Le
jour où l'un des deux apparaît, séparer `Candidature`/`Devis` redeviendrait justifié
— **pas avant**.

## Note de conception — lien futur avec `Lot.assigned_organization` (ticket 009)

Anticipation explicite, **rien à implémenter dans ce ticket** (voir « Explicitement
hors scope » ci-dessus, qui reste inchangé).

Aujourd'hui : verrouiller un devis (`lock_devis`) et affecter l'organisation
constructrice d'un lot (`LotViewSet.assign_organization`, ticket 009) restent DEUX
gestes manuels et indépendants d'`admin_keyimmo` — verrouiller un devis ne déclenche
rien côté `Lot.assigned_organization`.

**Automatisation prévue pour un futur ticket, pas un oubli** : `Lot.assigned_organization`
a été explicitement conçu au ticket 009 comme un « point d'ancrage minimal... à
ÉTENDRE, jamais redéfinir ». Le point d'extension naturel, le jour où ce lien est
demandé, est `apps.procurement.services.lock_devis` lui-même : après la création du
`TrustEvent` `devis_verrouille`, appeler `lot.assigned_organization =
devis.candidate_organization; lot.save(update_fields=['assigned_organization'])` —
réutilisation directe du champ et de la sémantique déjà posés au ticket 009, jamais
une redéfinition. Non fait ici pour deux raisons : (1) ni l'utilisateur ni ce ticket
n'ont demandé cette automatisation — l'ajouter maintenant anticiperait un ticket
futur (CLAUDE.md : « ne pas anticiper un ticket suivant dans l'implémentation d'un
ticket en cours ») ; (2) coupler les deux gestes mérite sa propre décision de
conception validée (ex. faut-il pouvoir verrouiller un devis SANS affecter le lot
dans certains cas ? Question ouverte, pas tranchée ici).

## Objectif

Modéliser une mise en concurrence de devis entre organisations constructeurs
candidates sur un `Lot`, avec un verrouillage (sélection du devis retenu) traçable
via `TrustEvent` — sans jamais qu'un montant ou une valeur qui en dérive (total,
marge, moyenne, rang implicite) ne soit exposé à une organisation candidate.

## Dépendances

- **Ticket 002** (`Lot`, `Program`, `Asset`) — un `Devis` porte sur un `Lot` existant.
- **Ticket 003** (`TrustEvent` append-only) — le verrouillage est un `TrustEvent`,
  jamais un champ `locked`/`status` stocké sur `Devis`.
- **Ticket 012** (`InspectionMission`) — deux patterns réutilisés tels quels, sans
  réinvention : (a) création exclusive par `admin_keyimmo`, bascule explicite du
  contexte RLS vers l'organisation cible (même schéma que `create_mission`) ; (b)
  policy RLS de lecture par comparaison de COLONNE (`organization_id = current_org OR
  candidate_organization_id = current_org`), jamais une sous-requête sur la table
  elle-même — c'est précisément ce qui avait déclenché la récursion RLS documentée au
  ticket 011.

## Entités touchées

- Nouvelle app `apps/procurement` (label `procurement`) — nouveau domaine métier,
  jamais un ajout à `apps/programs` ni `apps/core` (CLAUDE.md, section Structure).
- `Devis` (nouveau modèle).
- Aucune modification d'un modèle existant.

## Scope inclus

- `Devis` : `organization` (organisation du LOT, dénormalisée — même convention que
  `Inspection.organization`), `candidate_organization` (l'organisation constructeur
  candidate), `lot`, `amount`, `logged_by` (l'admin qui a saisi la ligne),
  `created_at`. Aucun champ statut stocké.
- Migration + policy RLS à deux branches (lecture), policy stricte à une branche
  (écriture) — voir Dépendances.
- `POST /api/procurement/devis/` (admin_keyimmo uniquement) — crée un `Devis`.
  Refusé (409) si le lot est déjà verrouillé (compétition close).
- `POST /api/procurement/devis/{id}/lock/` (admin_keyimmo uniquement) — verrouille un
  devis : crée un `TrustEvent` (`source='devis_verrouille'`). Refusé (409) si le lot
  a déjà un devis verrouillé.
- `GET /api/procurement/admin/lots/{lot_id}/devis/` (admin_keyimmo uniquement) —
  liste tous les devis d'un lot, **montants inclus** — seul endroit du projet où un
  montant de devis est exposé.
- `GET /api/procurement/my-candidatures/` et `GET .../my-candidatures/{id}/`
  (constructeur uniquement) — ses propres candidatures, **jamais de champ `amount`**,
  statut dérivé (`candidat`/`verrouille`) inclus.
- Test de garde exhaustif anti-fuite de montants (voir section dédiée).

## Explicitement hors scope

- **Pas de soumission directe par le candidat** (décision de conception 1).
- **Pas de lien avec `Lot.assigned_organization`** (ticket 009) : verrouiller un
  devis ne pose pas automatiquement l'organisation constructrice du lot. Ce lien
  attendrait un futur ticket, une fois le besoin confirmé — ne pas anticiper (CLAUDE.md,
  « Respecter le scope explicite de chaque ticket »).
- **Pas d'export réel** : aucun mécanisme d'export n'existe nulle part dans le projet
  à ce jour (vérifié — `grep -r "export"` sur `apps/` ne retourne rien). Le test de
  garde (balayage de `get_resolver()`, voir plus bas) couvre structurellement un futur
  export dès qu'il existera, sans modification de ce ticket — même principe que le
  test de gouvernance StatusBadge (ticket 007, `/apps` pas encore présent au moment
  d'écrire le test, couvert automatiquement le jour où il apparaît.
- **Pas de renégociation/modification d'un devis existant** : cohérent avec
  append-only — un nouveau montant est un NOUVEAU `Devis`, jamais une édition.
- **Pas de règle d'indépendance candidat/lot** (contrairement à l'inspecteur, ticket
  005) : rien n'empêche qu'une organisation candidate soit, par ailleurs, membre de
  l'organisation du lot — hors sujet de ce ticket.

## Critères d'acceptation

- [x] `admin_keyimmo` peut créer un `Devis` (`organization`, `lot`, `candidate_organization`,
      `amount`) ; tout autre rôle reçoit 403.
- [x] Créer un `Devis` sur un lot déjà verrouillé échoue explicitement (409), aucune
      ligne créée.
- [x] `admin_keyimmo` peut verrouiller un `Devis` (`POST .../lock/`) → un `TrustEvent`
      `devis_verrouille` est créé ; tout autre rôle reçoit 403.
- [x] Verrouiller un second devis du même lot, une fois un premier déjà verrouillé,
      échoue explicitement (409) — un seul devis verrouillé par lot.
- [x] Le statut d'un devis (`candidat`/`verrouille`) est **dérivé** du dernier
      `TrustEvent`, jamais stocké sur `Devis` (doctrine Visible Trust).
- [x] RLS : un `Devis` n'est visible que par (a) une lecture basculée sur
      l'organisation du lot (`admin_keyimmo`, via le service, comme `create_mission`),
      (b) l'organisation candidate elle-même, en lecture directe sous son propre
      contexte actif — comparaison de colonne, testé aussi en SQL brut (hors ORM),
      comme l'exige CLAUDE.md pour toute nouvelle table RLS.
- [x] Un constructeur candidat peut lister/lire SES PROPRES candidatures
      (`my-candidatures/`), jamais celles d'un autre candidat (404 explicite, même
      discipline que `_ClientLotScopedView`, ticket 008).
- [x] **Le champ `amount` n'apparaît JAMAIS dans une réponse accessible au rôle
      constructeur** — testé sur `my-candidatures/` (liste et détail) de façon directe,
      ET par un balayage plus large (voir ci-dessous) qui couvre tous les autres
      endpoints déjà accessibles à ce rôle (lots, programmes, biens, déclarations de
      travaux, preuves, documents, tâches, `build/lots`, `build/exceptions`).
- [x] Aucun endpoint hors `admin_keyimmo` n'expose de valeur dérivée d'un montant
      (total, moyenne, marge, rang implicite entre candidats).

## Test de garde anti-fuite de montants — cœur de ce ticket

Deux couches, jamais une seule :

1. **Test direct** sur les deux endpoints candidat (`my-candidatures/` liste et
   détail) : réponse désérialisée, absence de la clé `amount` dans chaque objet, ET
   absence de la valeur textuelle exacte du montant (deux montants distincts et
   reconnaissables, ex. `123456.78`/`987654.32`) dans le corps brut de la réponse —
   au cas où un futur champ renommerait `amount` sans supprimer la valeur elle-même.
2. **Balayage exhaustif** : un test authentifie un constructeur candidat propriétaire
   d'un vrai lot dans SA PROPRE organisation (fixture standard, comme
   `_setup_constructeur_org`) et interroge TOUS les endpoints GET déjà accessibles à
   ce rôle (lots, programmes, biens, déclarations de travaux, preuves, documents,
   tâches, `build/lots`, `build/exceptions`, `my-candidatures/`) — vérifie qu'aucune
   des deux valeurs de montant seedées n'apparaît nulle part dans le texte brut de
   chacune des réponses. Complété par un test de la liste EXACTE des URLs GET
   enregistrées (`get_resolver()`), sur le même principe que
   `TestBackofficeNeverExposesATrustEventShortcut::
   test_backoffice_urls_expose_exactly_the_three_documented_actions` (ticket 011) —
   toute route future ajoutée sans mise à jour consciente de ce test le fait échouer,
   pour qu'un futur endpoint (y compris un export, s'il apparaît un jour) ne puisse
   jamais échapper silencieusement à cette liste.

## Notes d'implémentation

**Structure livrée** : `apps/procurement` (label `procurement`) — `models.py`
(`Devis`), `services.py` (`create_devis`, `lock_devis`, `list_devis_for_lot_as_admin`,
`get_devis_status`, `is_lot_locked`), `serializers.py`
(`DevisAdminSerializer`/`DevisCandidateSerializer`/`DevisCreateSerializer`),
`views.py` (5 vues), `urls.py`, `migrations/0001_initial.py` +
`migrations/0002_devis_rls.py`, `tests.py` (18 tests). Enregistrée dans
`INSTALLED_APPS` (`config/settings.py`) et `config/urls.py`.

**Bug réel trouvé en écrivant les tests — statut dérivé silencieusement faux juste
après l'écriture qui vient pourtant de le poser** : `DevisAdminSerializer.get_status`/
`DevisCandidateSerializer.get_status` appellent `get_devis_status`, qui lit le dernier
`TrustEvent` du devis — mais `TrustEvent.organization` vaut TOUJOURS l'organisation du
LOT, jamais celle de qui lit. Trois appelants se trouvaient donc, par construction,
dans le mauvais contexte RLS au moment de cette lecture :

1. **La réponse de `DevisLockView` elle-même** : `lock_devis` restaure le contexte RLS
   vers l'organisation de l'ADMIN (son `finally`) AVANT que la vue ne sérialise sa
   réponse — le `TrustEvent` `devis_verrouille`, qui vient pourtant d'être créé dans
   CETTE MÊME requête, redevenait invisible sous ce contexte restauré. Un devis venait
   d'être verrouillé avec succès (`TrustEvent` réellement en base) mais la réponse HTTP
   elle-même annonçait `status: "candidat"` — silencieusement faux, sans aucune erreur.
2. **`DevisAdminListView`** — même cause, après sa propre restauration de contexte.
3. **`MyCandidaturesListView`/`Detail`** (le cas le plus grave) : un candidat lit SA
   PROPRE candidature sous SA PROPRE organisation active
   (`candidate_organization_id = current_org`) — jamais celle du lot
   (`organization_id`, celle qui porte le `TrustEvent`). Un candidat n'aurait
   **structurellement jamais pu voir** qu'il avait gagné un appel d'offres : son statut
   restait bloqué à `'candidat'` pour toujours, quel que soit l'état réel.

**Détecté par les tests, pas par relecture** : `test_admin_keyimmo_can_lock_a_devis`
échouait (`'candidat' != 'devis_verrouille'`) dès la première exécution de la suite —
exactement le genre de bug que ce projet cherche à révéler en écrivant les tests avant
de considérer un ticket terminé (CLAUDE.md, dernière ligne).

**Corrigé** en rendant `get_devis_status(devis, *, restore_organization_id)` sûr par
construction, quel que soit le contexte RLS de l'appelant au moment où elle est
appelée : bascule elle-même vers `devis.organization_id` (toujours connu, porté par
l'objet `devis` déjà en main) le temps de CETTE lecture, restaure vers
`restore_organization_id` (fourni explicitement par l'appelant — jamais deviné, même
discipline que `create_devis`/`lock_devis`). Les deux serializers reçoivent désormais
`context={'request': request}` (passé par chaque vue) pour connaître l'organisation
active RÉELLE à restaurer. `is_lot_locked` (appelée uniquement depuis
`create_devis`/`lock_devis`, déjà correctement basculés au moment de l'appel) garde une
lecture directe, sans bascule redondante — voir `services.py` pour le détail.

**Piège de test découvert en écrivant les tests eux-mêmes, distinct du bug ci-dessus**
: une relecture Django ORM directe (`Devis.objects.filter(...)`/`TrustEvent.objects.get(...)`)
juste après un appel `admin_client.post(...)` échoue silencieusement (résultat vide,
jamais une exception) — le contexte RLS de la connexion du PROCESS DE TEST reste celui
où la vue l'a laissé après sa propre restauration (l'organisation de l'admin), pas
celui qu'un test naïf suppose. Résolu en ne revérifiant JAMAIS l'état par une requête
ORM non basculée après un appel API de ce type — soit la réponse HTTP fait foi seule
(même discipline que `apps.backoffice.tests.py::test_admin_keyimmo_can_create_a_mission`,
ticket 012), soit une bascule RLS explicite est posée avant la relecture de
vérification (`set_rls_context(organization_id=sponsor_org.id)`, même schéma que les
tests RLS de `apps/inspections/tests.py`).

**Suite complète** : `apps/procurement` — 18/18 tests verts. Suite backend complète
relancée après implémentation pour confirmer l'absence de régression ailleurs (voir
résultat rapporté à l'utilisateur).
