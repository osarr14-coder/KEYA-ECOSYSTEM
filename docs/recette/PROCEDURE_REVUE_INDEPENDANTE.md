# Procédure — revue indépendante avant intégration (CDC R1 §11, §12.1)

> Statut : **à exécuter**. Préparée par la session qui a écrit le code (Claude Code, autonome,
> pour le Product Owner). Ce document **organise** la revue ; il ne la remplace pas et ne vaut
> pas approbation. Aucune fusion ni publication n'est faite par l'auteur.

## 1. Ce que le CDC exige

- §11 : « Revue indépendante avant intégration. Vérifier les capacités effectives de protection
  de branche et les identités ; ne pas prétendre qu'elles sont configurées sans preuve. Deux
  agents sous un même compte ne sont pas deux approbateurs indépendants. Si le contrôle
  technique prévu n'est pas disponible, documenter la limite et faire approuver un dispositif
  compensatoire avant fusion. »
- §12.1 : pour chaque test, conserver identifiant, version testée, résultat, preuve **et
  reviewer** ; un critère non testé est NOT_TESTED. La réception exige les tests réussis,
  **aucune anomalie critique connue sur permissions / états / finances / audit**, et une revue
  indépendante. Une dérogation est approuvée explicitement par le PO, avec son impact.

## 2. Objet de la revue

| | |
|---|---|
| Dépôt | `osarr14-coder/keya-ecosystem` |
| Branche revue | `fix/audit-ui-r1` |
| Base (dernier commit commun avec `master`) | `163b96c` (B-057 / F-079) |
| Version revue | le dernier commit de `fix/audit-ui-r1` au moment où la revue commence — **à noter en tête de la grille (§8)** ; tout commit ajouté ensuite impose de revoir son diff |
| Volume | 30 commits ; 331 fichiers, +22 756 / −2 937 lignes |
| Livrables de recette | `docs/recette/FICHE_T01_T20.md` (fiche de l'auteur), `docs/decisions/JOURNAL_DECISIONS.md` (décisions PO) |
| Hors périmètre | branche `audit/parcours-r1` (rapport d'audit seul, non destiné à `master`) ; déploiement Render (non fait, sur accord du PO) |

Commande pour afficher le périmètre :

```bash
git fetch origin
git log --reverse --oneline 163b96c..origin/fix/audit-ui-r1
git diff --stat 163b96c..origin/fix/audit-ui-r1
```

## 3. Faits établis sur les contrôles techniques (29 septembre 2026)

| Contrôle | Constat | Preuve |
|---|---|---|
| Auteur des commits | Les 30 commits portent l'identité git `Claude <noreply@anthropic.com>` et le trailer `Assisted-by: Claude Code (autonomous)` | `git log --format='%an <%ae> %(trailers:key=Assisted-by,valueonly)' 163b96c..origin/fix/audit-ui-r1` |
| Compte GitHub qui a poussé | **Non déterminé** par la session (poussée via le proxy de la session). Probablement le compte du PO | À lire dans l'historique GitHub de la branche |
| Protection de `master` | **Non vérifiée** : la session n'a pas accès aux réglages du dépôt | À relever par le PO (§4, étape 1) |
| Intégration continue | **Aucune** : pas de `.github/workflows/` dans le dépôt ; aucune vérification automatique sur une pull request | `ls .github` |
| Organisation des agents (`docs/ai-factory/`, cité par le §11) | **Absente** du dépôt | `ls docs/ai-factory` |

Conséquences :

- **L'auteur ne peut pas être relecteur.** Une autre session Claude, ou un autre agent, sous le
  même compte ne compte pas comme approbateur indépendant (§11). Elle peut aider le relecteur,
  mais pas approuver.
- Si l'auteur a poussé avec le compte GitHub du PO, une pull request ouverte depuis ce compte
  ne peut pas être approuvée par ce même compte. Une approbation GitHub valable vient donc
  d'**un autre compte**.

## 4. Étapes

### Étape 1 — PO : vérifier les capacités et désigner le relecteur (avant tout)

1. Dans GitHub, **Settings → Branches** (ou **Rules → Rulesets**) du dépôt, relever pour `master` :
   - si une règle existe et si elle est réellement appliquée ;
   - s'il faut une pull request pour fusionner, et combien d'approbations ;
   - si une nouvelle poussée annule les approbations déjà données ;
   - si les administrateurs sont soumis à la règle ;
   - qui peut pousser directement sur `master`.

   Selon l'offre GitHub du compte, une règle peut s'afficher sans être appliquée à un dépôt
   privé : noter ce qui est **effectivement** appliqué. Faire une capture d'écran à titre de preuve.
2. Relever les comptes qui ont accès en écriture (**Settings → Collaborators**).
3. **Désigner le relecteur** : une personne distincte de l'auteur, avec son propre compte GitHub,
   capable de lire du Django/DRF et du React. Consigner son nom, son compte et son rôle.
4. Si aucun contrôle technique n'est disponible (protection absente ou non appliquée, pas de
   second compte), **choisir un dispositif compensatoire**, l'inscrire au journal (nouvel
   identifiant PO) et l'approuver **avant** la fusion (§5).

### Étape 2 — Relecteur : préparer un environnement local indépendant

Le relecteur utilise **son propre clone** et **sa propre base**, jamais l'environnement de l'auteur.

1. `git clone` puis `git checkout fix/audit-ui-r1`. Noter le commit revu : `git rev-parse --short HEAD`.
2. Postgres du projet : `docker compose up -d` dans `backend/` (port hôte `5433`, cf. `CLAUDE.md` § Stack).
3. Backend : environnement virtuel, `pip install -r backend/requirements.txt`, migrations.
4. Fronts : `npm ci` à la racine (espaces de travail `apps/*`, `packages/*`).
5. Jeu de démonstration : suivre `docs/exploitation/PROCEDURE_REINITIALISATION_DEMO.md`, d'abord
   le contrôle sans écriture (§3.1). Le **mot de passe des comptes de démo** est choisi par le
   relecteur lui-même au moment de l'exécution, passé par la variable `DEMO_PASSWORD`, et
   n'est écrit dans **aucun** fichier, capture ou compte rendu.
6. Lancer les applications et ouvrir une fenêtre par rôle selon
   `docs/demo/PROCEDURE_DEMONSTRATION.md` §1 (15 s entre deux connexions).

### Étape 3 — Relecteur : relancer les suites automatisées

```bash
cd backend && python -m pytest -q -p no:cacheprovider --create-db     # attendu : 736 passés
npx vitest run --root apps/web          # 352
npx vitest run --root apps/build        # 114
npx vitest run --root apps/home         # 141
npx vitest run --root apps/control-pwa  # 88 (+2 ignorés : hors ligne différé)
npx vitest run --root packages/design-system   # 246
for a in apps/web apps/build apps/home apps/control-pwa packages/design-system; do npx tsc --noEmit -p $a; done
```

Utiliser l'environnement virtuel **du clone** : un interpréteur global peut importer le code
d'un autre répertoire. Consigner les nombres obtenus
dans la grille (§8). Un écart par rapport aux nombres attendus constitue une anomalie.

### Étape 4 — Relecteur : lire le code (priorité aux quatre domaines de la réception)

Lire le diff commit par commit (`git show <commit>`), dans l'ordre du §2. Pour chaque domaine,
les points à vérifier :

**Permissions**
- Chaque route nouvelle ou modifiée : classe de permission, rôle exigé, organisation active.
  Un accès refusé ne doit rien révéler : 404 plutôt que 403 quand l'existence est
  confidentielle (T08).
- Chaque bascule du contexte RLS (`set_rls_context(organization_id=…)`) : bornée et restaurée
  dans un `finally`, sans élargir ce que l'appelant peut lire. Par exemple
  `sales/services.py::lot_chantier_is_open`, `list_disbursements_as_beneficiary`.
- Garde de l'archive (lot 5) : `core/middleware.py` (409 sur toute écriture en consultation
  d'archive) et `core/archive.py` (signal sur les modèles métier). **Limite déclarée** : une
  écriture de masse (`update()`) n'émet pas de signal.
- Consultation d'archive réservée à l'administrateur et au gestionnaire (A6).

**États**
- Réservation : `REQUESTED → HELD → RESERVED → COMMITTED`, sorties `EXPIRED` et `CANCELLED`
  (`sales/services.py`). `COMMITTED` est terminal.
- Nouvelle règle PO-2026-09-29-09 : pas de déclaration de jalon avant la concrétisation
  (`evidence/services.py::create_work_declaration`, seul chemin de création).
- Jalon : état calculé à la lecture, jamais stocké (`inspections/services.py`) ; réserve levée
  seulement par le contrôleur, par une décision explicite (T05, T06) ; pièce ajoutée après
  acceptation ⇒ nouvelle revue (T07).
- Instance d'archive : aucune expiration, aucune réévaluation ne doit y écrire.

**Finances**
- Frais inclus dans le premier versement, jamais déduits deux fois (T03).
- Encaissement et affectation : idempotence, excédent non affecté jamais consommé deux fois (T10, T12).
- Décaissement : éligibilité (réserve ouverte, disponible insuffisant), verrouillage
  (`select_for_update`), jamais de solde négatif (T09, T10).
- Tout montant est marqué simulé ; aucun écran n'affiche une opération réelle.

**Journal (audit)**
- Chaque événement critique est enregistré dans la même transaction que son effet.
- Tables `audit_event` et `trust_event` : aucun `UPDATE`/`DELETE` possible pour le compte
  applicatif (T16).
- Journal de l'archive limité à sa période ; rien n'est supprimé.

**Autres points à vérifier**
- Dépôts (§10) : `evidence/validators.py`. L'extension, le type déclaré et le contenu doivent
  concorder (PO-2026-09-29-05) ; taille maximale 10 Mo.
- Secrets : aucun mot de passe, jeton ou `.env` dans le diff
  (`git diff 163b96c..HEAD | grep -niE "password|secret|token"` puis lecture des résultats).
- **Tests modifiés par l'auteur** : vérifier qu'aucune assertion n'a été affaiblie. Les
  adaptations sont signalées par un commentaire « Adapté selon PO-… » ou par la référence
  PO-2026-09-29-05 / -09. Le cas le plus large : l'aide `sales/testing.py::commit_lot`
  (PO-2026-09-29-09) concrétise le dossier d'un lot avant les déclarations de test. Vérifier
  qu'elle n'est jamais importée par le code applicatif et que la règle elle-même reste
  couverte par `build/test_ordre_scenario.py`.

### Étape 5 — Relecteur : rejouer T01 à T20

Rejouer chaque test **lui-même**, en partant de la fiche de l'auteur (`FICHE_T01_T20.md` : mode
et preuve de chaque test), mais sans reprendre son résultat. Pour chaque test, consigner dans la
grille (§8) :

- le mode (écran, API, test automatisé) ;
- sa **propre** preuve (capture, sortie de commande, nom du test) ;
- son résultat : CONFORME, PARTIEL, NON CONFORME ou NOT_TESTED.

Points d'attention transmis par l'auteur (limites déjà déclarées) :

| Test | Limite déclarée |
|---|---|
| T02 | Rejoué avec un blocage d'1 h en local (arbitrage A7), puis remis à 24 h ; jamais sur Render |
| T07 | Vérifié par l'API seulement ; non rejouable à l'écran (PO-2026-09-29-06) |
| T10, T18 | Tests automatisés seulement |
| T13 | Export de justificatif reporté au Projet 1 (PO-2026-09-29-07) |
| T17 | Sauvegarde et restauration faites par l'auteur sur sa base locale ; **à refaire** par le relecteur |
| T19 | « Par utilisateur non technicien » : **NOT_TESTED** — à faire jouer par une personne non technicienne, sans aide sur l'outil |
| PO-09 | Le cas « dossier concrétisé puis déclaration » n'a pas été rejoué à l'écran par l'auteur : il sera couvert par les parcours de T19 |
| Environnement | Tout a été joué sur une pile locale. Le §12.1 demande l'environnement de démonstration ou un environnement équivalent documenté : décider si l'environnement local du relecteur en tient lieu |

### Étape 6 — Relecteur : classer les anomalies

| Gravité | Définition | Effet |
|---|---|---|
| **Critique** | Touche les permissions, les états, les finances ou le journal (§12.1). Exemples : fuite entre clients ou organisations, transition interdite possible, montant faux ou doublé, événement modifiable ou perdu, simulation présentée comme réelle | Bloque la fusion. Correction et nouvelle revue du correctif |
| **Majeure** | Empêche une étape du §9.2 ou un test T01–T20 sans toucher aux quatre domaines | Bloque, sauf dérogation PO écrite avec son impact |
| **Mineure** | Libellé, présentation, confort | Consignée ; peut être traitée après la fusion |

### Étape 7 — Décision

- **Revue favorable** si :
  - aucune anomalie critique n'est ouverte ;
  - chaque anomalie majeure est corrigée ou couverte par une dérogation PO écrite ;
  - les tests T01–T20 sont CONFORMES, ou relèvent d'une dérogation ou d'un report décidé
    (T13 export) ;
  - les suites sont vertes.
- Les corrections demandées sont faites **sur la branche**, puis **leur diff est relu** avant la
  décision finale.
- **La fusion est faite par le PO ou une personne qu'il désigne, jamais par l'auteur.** Si une
  pull request est utilisée, l'approbation vient du compte du relecteur.
- La décision (favorable, défavorable, dérogations) est inscrite au journal des décisions avec
  la référence de la grille remplie.

## 5. Si le contrôle technique est indisponible : dispositif compensatoire à faire approuver

À retenir si l'étape 1 montre qu'aucune protection de branche n'est appliquée, ou qu'il n'y a
pas de second compte GitHub. Il faut **au moins** :

1. une revue humaine par une personne distincte de l'auteur, consignée dans la grille (§8) et
   signée par écrit ;
2. la version revue (commit) figée dans la grille ; la fusion porte **exactement** sur ce
   commit (`git merge --no-ff <commit>`). Tout écart impose une nouvelle revue ;
3. la fusion faite par le PO, après la signature, et inscrite au journal (commit revu, commit
   de fusion, date) ;
4. les suites relancées par le relecteur sur ce commit (étape 3), avec leurs nombres consignés,
   pour compenser l'absence d'intégration continue ;
5. la limite déclarée au journal : « protection de branche non appliquée, revue compensatoire
   PO-… ».

L'aide d'une autre session d'agent (relecture assistée, rejeu) est possible, mais elle ne
remplace ni le point 1 ni la signature.

## 6. Ce que l'auteur fournit au relecteur

- Cette procédure, la fiche de l'auteur, le journal des décisions (PO-2026-09-29-01 à -09) et
  les procédures de démonstration et de réinitialisation.
- Le compte rendu de la vérification finale avec ses captures (page privée du PO, à partager
  s'il le souhaite).
- Aucun mot de passe : le relecteur choisit le sien pour sa base (étape 2).

## 7. Durée indicative

Environ 1 h pour l'étape 1 (PO), puis 1 à 1,5 jour pour les étapes 2 à 6 (relecteur),
selon sa familiarité avec la pile. Il faut y ajouter le temps de l'utilisateur non technicien
pour T19.

## 8. Grille du relecteur (à remplir)

| | |
|---|---|
| Relecteur (nom, compte GitHub, rôle) | |
| Indépendance (distinct de l'auteur : oui/non ; lien avec le projet) | |
| Commit revu (`git rev-parse --short HEAD`) | |
| Date(s) | |
| Protection de `master` relevée (étape 1) | |
| Dispositif compensatoire (si besoin) — identifiant PO | |
| Environnement de rejeu | |

**Suites (étape 3)**

| Suite | Attendu | Obtenu |
|---|---|---|
| Backend | 736 passés | |
| web / BUILD / HOME / Contrôle / design system | 352 / 114 / 141 / 88 (+2) / 246 | |
| Types (5 espaces) | 0 erreur | |

**Tests T01–T20 (étape 5)**

| Test | Mode | Preuve du relecteur | Résultat | Remarque |
|---|---|---|---|---|
| T01 | | | | |
| T02 | | | | |
| T03 | | | | |
| T04 | | | | |
| T05 | | | | |
| T06 | | | | |
| T07 | | | | |
| T08 | | | | |
| T09 | | | | |
| T10 | | | | |
| T11 | | | | |
| T12 | | | | |
| T13 | | | | |
| T14 | | | | |
| T15 | | | | |
| T16 | | | | |
| T17 | | | | |
| T18 | | | | |
| T19 | | | | |
| T20 | | | | |

**Anomalies (étapes 4 à 6)**

| N° | Domaine (permissions / états / finances / journal / autre) | Gravité | Description et preuve | Fichier / test | Suite donnée |
|---|---|---|---|---|---|
| | | | | | |

**Décision (étape 7)**

| | |
|---|---|
| Revue favorable / défavorable | |
| Dérogations PO (identifiants, impact) | |
| Signature du relecteur, date | |
| Visa du PO, date | |
