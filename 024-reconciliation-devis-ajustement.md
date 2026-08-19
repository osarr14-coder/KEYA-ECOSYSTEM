# Ticket 024 — Réconciliation de devis / ajustement

## ⚠️ Écart de modèle corrigé avant rédaction

La version initiale de ce ticket supposait trois entités distinctes
(`Devis`/`Candidature`/`AppelOffre`) et des `DevisLigne`. Vérifié directement dans
`apps/procurement/models.py` (`master`, commit `3dae19e`) : **aucune de ces entités
n'existe sous ces noms**. Le ticket 022 a fusionné volontairement candidature et devis
en un seul modèle `Devis` (une ligne par couple lot/organisation candidate, montant
global, pas de lignes de détail) — décision de conception explicitement validée avant
implémentation à l'époque. Ce ticket s'appuie donc sur le modèle RÉEL, sans recréer
`Candidature`/`AppelOffre`/`DevisLigne`.

## Statut

**Livré.** Backend/API uniquement (aucune interface utilisateur, comme prévu).
32/32 tests `apps/procurement` verts.

## Décisions de conception actées

1. **`marge_estimee` ajouté directement sur `Devis`, jamais dérivé par soustraction
   ailleurs dans le code** — nouveau champ (`DecimalField`), saisi par `admin_keyimmo`
   en même temps que `amount` (même geste administratif, même acteur — cohérent avec
   la décision de conception 1 du ticket 022). `amount` reste le montant de
   construction estimé du devis ; `marge_estimee` est une donnée SÉPARÉE, jamais
   calculée à partir d'un budget externe (aucun champ budget n'existe sur `Lot`, et ce
   ticket n'en introduit pas). Cohérent avec la doctrine citée (« marge affichée comme
   ligne distincte, jamais noyée », section 6 du modèle économique) — **document non
   retrouvé dans aucun projet accessible sur cette machine** (recherché explicitement,
   aucun résultat) : appliqué au mieux de ma compréhension du principe énoncé, à
   confirmer si le document existe ailleurs.
2. **La « réconciliation » porte sur le devis VERROUILLÉ (l'offre gagnante) UNIQUEMENT**
   — confirmé : plusieurs `Devis` existent bien pour un même lot (un par candidat,
   c'est la mise en concurrence elle-même, ticket 022), mais un seul peut jamais être
   verrouillé par lot (`is_lot_locked`, contrainte déjà en place). « Le candidat
   gagnant et son offre » = le `Devis` avec un `TrustEvent` `devis_verrouille` — pas de
   nouvelle notion de sélection à créer, celle du ticket 022 suffit.
3. **Aucune modification de `Devis` par ce mécanisme, à aucun moment** — un ajustement
   est un NOUVEL enregistrement séparé (`DevisAjustement`, voir plus bas), jamais un
   champ modifié sur `Devis` lui-même. `Devis` reste protégé par la policy RLS posée au
   ticket 022 (aucune policy `UPDATE`/`DELETE` définie + `FORCE ROW LEVEL SECURITY` =
   déni par défaut, déjà vrai aujourd'hui sans rien ajouter) — voir section garde
   dédiée plus bas pour le test qui le prouve avec la même rigueur que l'append-only de
   `TrustEvent` (ticket 003).

## Points de conception — tranchés avec l'utilisateur avant implémentation

**A. Ajustements cumulés, avec distinction de signe (TRANCHÉ)**

Plusieurs `DevisAjustement` par devis verrouillé, `ecart` est une valeur **signée** :
positif = défavorable (surcoût, réduit la marge disponible), négatif = favorable
(économie, augmente la marge disponible). Marge disponible AU MOMENT d'un nouvel
ajustement = `marge_estimee − somme signée des écarts déjà acceptés` — jamais une
somme des valeurs absolues, jamais un traitement uniforme des deux sens. Testé
explicitement par un enchaînement écart favorable PUIS défavorable sur le même devis,
qui prouve que le second est jugé contre la marge déjà AUGMENTÉE par le premier (pas
contre `marge_estimee` seule) — un calcul qui ignorerait le signe rejetterait à tort
un écart défavorable qu'un enchaînement réel aurait dû absorber grâce à l'économie
précédente.

**B. Task sur ajustement refusé, assignée à l'acteur courant (TRANCHÉ)**

Un ajustement REFUSÉ (écart au-delà de la marge disponible courante) crée une `Task`
(`TaskType.ALERT`) assignée à `request.user` (l'`admin_keyimmo` qui vient de tenter
l'ajustement) — pas de résolveur de contact sponsor à inventer, `assignee` est déjà
connu du contexte de la requête. Aucun pattern existant n'assigne déjà une Task à
l'acteur courant plutôt qu'à un tiers (`_reserve_opened_label`/`_mission_assigned_label`
assignent tous deux à quelqu'un D'AUTRE que l'appelant) — mais le mécanisme sous-jacent
(`Task.objects.create(assignee=..., ...)`, `apps.tasks.services._get_or_create_task`)
est générique et ne suppose rien sur qui `assignee` doit être : réutilisé tel quel,
seule la valeur passée diffère. Déduplication par `_get_or_create_task` avec la clé
`(subject_type=Devis, subject_id=devis.id, source='devis_ajustement_refuse')` — une
alerte déjà existante et encore non traitée n'est pas dupliquée par une seconde
tentative refusée sur le même devis (même discipline que ticket 017).

**C. Aucune visibilité candidate sur `DevisAjustement` lui-même, MAIS bug réel trouvé
et corrigé sur le statut « gagnant » déjà exposé (ticket 022) (TRANCHÉ)**

Pas de nouvel endpoint candidat pour lire un `DevisAjustement` (cohérent avec la
décision 1 du ticket 022 — aucun changement ici).

**Vérifié factuellement avant de trancher, comme demandé** :
`DevisCandidateSerializer.get_status` (`apps/procurement/serializers.py`, ticket 022)
appelle EXACTEMENT le même `services.get_devis_status` que le serializer admin —
**aucun gating**. Un candidat voit `status: "devis_verrouille"` dès l'INSTANT où
`admin_keyimmo` verrouille son devis (`lock_devis`), sans aucun lien avec une
réconciliation — parce qu'au moment du ticket 022, la réconciliation n'existait pas
encore. C'est bien le premier cas décrit : **un vrai problème, corrigé dans CE
ticket**, pas seulement documenté.

**Corrigé par une nouvelle fonction, `get_candidate_visible_devis_status`** — distincte
de `get_devis_status` (qui reste INCHANGÉE, utilisée telle quelle par le serializer
admin ET par la logique interne `create_devis`/`lock_devis`/`is_lot_locked`, qui ont
besoin du statut RÉEL immédiatement, y compris pour empêcher un second verrouillage
sur le même lot). `get_candidate_visible_devis_status` retourne le même statut SAUF
si le statut réel est `devis_verrouille` ET qu'aucun `DevisAjustement` n'existe encore
pour ce devis — dans ce cas, retourne `'candidat'` : le candidat ne voit « gagnant »
qu'une fois AU MOINS une réconciliation réussie enregistrée (un ajustement refusé ne
crée jamais de ligne, donc ne peut jamais, à tort, faire apparaître ce statut).
`DevisCandidateSerializer.get_status` est mis à jour pour appeler cette nouvelle
fonction — seul changement de comportement sur du code déjà livré au ticket 022.

## Objectif

Permettre à `admin_keyimmo` d'enregistrer un ajustement de coût (écart) sur le devis
VERROUILLÉ d'un lot, refusé explicitement si l'écart dépasse la marge disponible
(`marge_estimee`, éventuellement déjà réduite par des ajustements antérieurs — point A)
— sans jamais modifier le `Devis` d'origine.

## Dépendances

- **Ticket 022** (`Devis`, verrouillage, RLS deux branches) — le sujet de la
  réconciliation.
- **Ticket 003** (`TrustEvent` append-only) — modèle de rigueur pour la garde
  d'immutabilité du `Devis`, pas nécessairement un nouveau `TrustEvent` lui-même (un
  `DevisAjustement` est un enregistrement de fait, pas une affirmation de confiance sur
  un jalon/preuve — à confirmer si un `TrustEvent` est quand même souhaité en plus, pas
  proposé par défaut ici).
- **Ticket 006** (Task Inbox) — un ajustement refusé crée une `Task` (`TaskType.ALERT`,
  point B), en réutilisant `apps.tasks.services._get_or_create_task` tel quel.

## Entités touchées

- `apps/procurement/models.py` : `Devis` (+ `marge_estimee`), nouveau modèle
  `DevisAjustement`.
- Migration : ajout de colonne (`Devis.marge_estimee`, valeur par défaut à discuter
  pour les lignes déjà existantes en base, s'il y en a) + nouveau modèle + RLS.

## Scope inclus

- `Devis.marge_estimee` (nouveau champ requis à la création — `create_devis`,
  `DevisCreateSerializer` étendus en conséquence).
- `DevisAjustement` : `devis` (FK), `organization` (dénormalisée depuis
  `devis.organization`), `ecart` (montant SIGNÉ), `created_by`, `created_at`. RLS
  standard (`organization_id = current_org` seul — pas de branche candidate, point C).
- `POST /api/procurement/devis/{id}/ajustements/` (`admin_keyimmo` uniquement) :
  - 404 si le devis n'existe pas dans l'organisation cible.
  - 409 si le devis n'est pas verrouillé (pas l'offre gagnante).
  - 409 si `ecart` dépasse la marge disponible COURANTE (`marge_estimee` moins la somme
    signée des écarts déjà acceptés, point A) — **aucune ligne créée**, et une `Task`
    `ALERT` créée/réutilisée (point B).
  - 201 sinon, avec `marge_resultante` dans la réponse (dérivée, jamais stockée).
- `GET /api/procurement/devis/{id}/ajustements/` (`admin_keyimmo` uniquement) — liste
  des ajustements d'un devis, montants inclus.
- **Correctif ticket 022** : `get_candidate_visible_devis_status` (nouvelle fonction),
  branchée dans `DevisCandidateSerializer.get_status` — le statut « gagnant » exposé au
  candidat n'apparaît qu'après au moins un ajustement accepté (point C).

## Explicitement hors scope

- Lecture candidate d'un `DevisAjustement` lui-même (point C — seul le statut dérivé du
  `Devis`, déjà exposé au ticket 022, est concerné par le correctif).
- Toute modification du flux de verrouillage lui-même (`lock_devis`, ticket 022,
  inchangé — verrouiller reste immédiat, seule la VISIBILITÉ candidate est gatée).
- Un futur champ budget sur `Lot` (aucun aujourd'hui) — `marge_estimee` reste une
  donnée saisie manuellement par devis, pas dérivée d'un budget de programme.

## Critère d'acceptation central — cas limite exact

- [x] Écart == marge disponible exactement (0 décimale d'écart) → **accepté**, marge
      résultante == 0 (Decimal exact, pas une comparaison flottante approximative).
- [x] Écart == marge disponible + 0,01 → **refusé** (409), aucune ligne créée.
- [x] Écart < marge disponible → accepté, marge résultante > 0.
- [x] Écart > marge disponible (au-delà du cas limite, un écart largement supérieur) →
      refusé.

## Autres critères d'acceptation

- [x] Seul `admin_keyimmo` peut créer un ajustement ; tout autre rôle → 403.
- [x] Un ajustement sur un devis NON verrouillé échoue explicitement (409), aucune
      ligne créée.
- [x] **Cumul signé (point A)** : un écart favorable (négatif) accepté AUGMENTE la
      marge disponible pour l'ajustement suivant ; un écart défavorable (positif)
      accepté la RÉDUIT. Test dédié : écart favorable PUIS écart défavorable sur le
      même devis, le second jugé contre la marge déjà augmentée par le premier — un
      écart qui aurait été refusé contre `marge_estimee` seule doit passer une fois
      l'économie précédente prise en compte.
- [x] **Task sur refus (point B)** : un ajustement refusé crée une `Task`
      (`TaskType.ALERT`) assignée à l'`admin_keyimmo` appelant ; une seconde tentative
      refusée sur le MÊME devis ne duplique pas la Task (déduplication
      `_get_or_create_task`, même clé).
- [x] **Statut candidat gaté (point C, correctif ticket 022)** : `my-candidatures/`
      (liste et détail) montre `status: "candidat"` pour un devis verrouillé SANS
      ajustement accepté, et `status: "devis_verrouille"` seulement après au moins un
      ajustement accepté — testé par un enchaînement réel (verrouiller → lire côté
      candidat, encore "candidat" → ajustement accepté → relire côté candidat,
      "devis_verrouille" désormais).
- [x] `Devis` et son `marge_estimee`/`amount` d'origine ne sont JAMAIS modifiés par ce
      mécanisme — testé avec la même rigueur que l'append-only `TrustEvent` (ticket
      003) : tentative directe d'`UPDATE` en SQL brut sur `procurement_devis` (hors
      ORM) après un ajustement, `cursor.rowcount == 0` attendu (RLS bloque déjà tout
      UPDATE, aucune policy définie) ; et `Devis.objects.get(...)` relu après un
      ajustement accepté, `amount`/`marge_estimee` inchangés bit à bit.
- [x] RLS : un `DevisAjustement` suit le même schéma de bascule que `Devis`
      (organisation du lot).
- [x] Documentation (fichier ticket + section CLAUDE.md), tests écrits avant de
      considérer le ticket terminé.

## Notes d'implémentation

**Fichiers touchés** : `apps/procurement/models.py` (`Devis.marge_estimee` +
`DevisAjustement`), `services.py` (`available_margin`, `create_ajustement`,
`list_ajustements_for_devis_as_admin`, `get_candidate_visible_devis_status`,
`create_devis`/`_create_devis_row` étendus), `serializers.py`
(`DevisAjustementCreateSerializer`/`DevisAjustementAdminSerializer`,
`DevisCreateSerializer`/`DevisAdminSerializer` étendus,
`DevisCandidateSerializer.get_status` reciblé), `views.py`
(`DevisAjustementView`), `urls.py`, migrations `0003_devis_marge_estimee_
devisajustement.py` + `0004_devisajustement_rls.py`. **Hors `apps/procurement`** :
`apps/tasks/services.py` (`create_task_for_devis_ajustement_refuse`,
`_devis_ajustement_refuse_label`, ajout à `LABEL_GENERATORS`) — touché
consciemment, dépendance ticket 006 explicitement demandée.

**Bug de transaction trouvé et corrigé en écrivant les tests, distinct du bug
RLS du ticket 022** : la première version de `create_ajustement` créait la
`Task` d'alerte PUIS levait `MarginExceededError` À L'INTÉRIEUR du même
`with transaction.atomic():` — une exception qui se propage hors de ce bloc
fait ROLLBACK de tout ce qui y a été écrit, Task incluse, la faisant
disparaître silencieusement malgré un 409 réellement renvoyé au client (le
test `test_rejected_ajustement_creates_an_alert_task_assigned_to_the_acting_admin`
aurait échoué — corrigé AVANT de lancer les tests, en relisant le code juste
après l'avoir écrit, pas détecté a posteriori par un test rouge cette
fois-ci). Corrigé en restructurant `create_ajustement` en étapes séquentielles
distinctes (lecture seule → écriture Task hors de toute portée annulable →
`raise` ; OU écriture `DevisAjustement` dans son propre `atomic()`), voir la
docstring de la fonction pour le détail complet.

**Choix explicite, pas un oubli** : la Task sur refus est créée SYNCHRONEMENT
(appel direct, pas de `.delay()` Celery), à la différence des deux
générateurs précédents du ticket 006 — justifié dans la docstring de
`create_task_for_devis_ajustement_refuse` (le refus a lieu dans la même
requête que la tentative de l'admin, qui reçoit déjà un 409 immédiat ; la
Task n'est qu'une trace durable dans son inbox, pas un traitement qui
bénéficierait d'un découplage réseau).

**`marge_resultante` calculée pendant la bascule, jamais après** — même
piège RLS que `get_devis_status` (ticket 022) : sérialiser ce champ après
restauration du contexte aurait pu échouer silencieusement de la même façon.
Évité en calculant `marge_resultante` À L'INTÉRIEUR de la bascule, dans
`create_ajustement` lui-même, retournée en tuple `(ajustement,
marge_resultante)` plutôt que via un `SerializerMethodField` qui aurait
nécessité sa propre bascule dédiée.

**Test d'immutabilité ajouté au-delà du strict périmètre demandé** :
`test_direct_sql_update_on_devis_ajustement_is_also_blocked` — pas seulement
`Devis`, mais un `DevisAjustement` déjà créé est lui aussi protégé contre
toute révision après coup (cohérent avec append-only : un nouvel ajustement
est un NOUVEL enregistrement, jamais une édition), gratuitement par la même
policy RLS sans UPDATE/DELETE.

**Suite** : `apps/procurement` — 32/32 tests verts (18 du ticket 022,
inchangés sauf un test de statut candidat corrigé pour refléter le nouveau
comportement gaté, + 14 nouveaux). Suite backend complète relancée après
implémentation pour confirmer l'absence de régression ailleurs (notamment
`apps/tasks`, modifié par ce ticket) — voir résultat rapporté à
l'utilisateur.
