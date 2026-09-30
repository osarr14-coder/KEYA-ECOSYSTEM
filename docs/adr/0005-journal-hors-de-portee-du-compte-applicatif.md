# ADR 0005 — Journal hors de portée du compte applicatif

## Statut

**Acceptée par le Product Owner le 29 septembre 2026** (journal des décisions,
PO-2026-09-29-10 : « retire la propriété des tables au compte applicatif »). Appliquée à la
base locale ; **non appliquée à Render** (aucun déploiement sans accord du PO, voir
« Conséquences »).

## Contexte

Le CDC R1 §10 exige que « l'utilisateur applicatif ne dispose pas de modification/suppression
du journal » ; T16 le vérifie.

Les tables `audit_event` (journal d'audit) et `trust_event` (niveaux de confiance) étaient
protégées par des triggers (`*_no_update`, `*_no_delete`) et par RLS forcée sans policy
d'écriture : un `UPDATE` ou un `DELETE` du compte applicatif touchait 0 ligne. La revue
assistée (`docs/recette/REVUE_ASSISTEE_R1.md`) a montré que ce n'était pas suffisant : le
compte applicatif `keya_ecosystem_app`, qui exécute aussi les migrations, était propriétaire
de la base, du schéma `public`, des deux tables et de leurs fonctions de trigger. Il pouvait
donc :

- vider le journal (`TRUNCATE`, que ni RLS ni les triggers de ligne n'arrêtent) ;
- supprimer les tables (droit du propriétaire du schéma) ;
- désactiver les triggers, retirer FORCE ROW LEVEL SECURITY, puis modifier un événement ;
- réécrire le corps des fonctions de trigger.

## Décision

Séparer **qui possède** le journal de **qui l'utilise** :

1. Un rôle propriétaire **sans connexion**, `keya_ecosystem_owner`, dont le compte applicatif
   **n'est pas membre**, possède la base, le schéma `public`, les tables `audit_event` et
   `trust_event`, leurs séquences et leurs fonctions de trigger.
2. Le compte applicatif reçoit : sur le journal, **`SELECT` et `INSERT` seulement** (plus
   l'usage des séquences) ; sur le schéma, `USAGE` et `CREATE` (il continue de créer et de faire
   évoluer **ses** tables métier par les migrations) ; sur la base, `CONNECT` et `TEMPORARY`.
3. Le transfert est fait par un **administrateur Postgres**, jamais par le compte applicatif
   (qui ne peut pas se retirer ses propres droits) : `backend/scripts/sql/protect_journal.sql`,
   idempotent, exécuté **après** les migrations. Le script échoue sans rien appliquer si le
   compte applicatif est membre du rôle propriétaire.
4. Un contrôle en lecture seule, exécuté **par le compte applicatif** :
   `manage.py check_journal_protection`, qui échoue tant qu'un moyen de modifier ou de supprimer
   le journal subsiste (propriété de la base, du schéma, des tables ou des fonctions ; droit
   `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER` ou `REFERENCES` ; RLS non forcée ; trigger
   désactivé).

Les tables métier restent possédées par le compte applicatif : le CDC ne demande la protection
que du journal, et ce découpage évite de refondre le déploiement.

## Conséquences

- **Réinitialisation locale** (`backend/scripts/reset_demo_local.sh`) : étape 4/6 ajoutée —
  protection puis contrôle, après les migrations ; le mode `--dry-run` contrôle aussi la
  protection. La commande de restauration affichée repasse le script.
- **Migrations touchant `audit_event` ou `trust_event`** : le compte applicatif ne peut plus
  les appliquer (il n'est plus propriétaire). Toute évolution de ces tables se fera par une
  opération d'exploitation privilégiée, tracée (CDC §10), puis le script est rejoué. Aucune
  migration en attente sur ces tables à la date de l'ADR.
- **Suppression d'une archive échue** (A6, PO-2026-09-29-04) : elle ne peut, de toute façon,
  être faite que par le propriétaire ou un superutilisateur — conforme à « opération
  d'exploitation privilégiée ».
- **Base de test** : pytest crée sa base avec le compte qui s'y connecte, qui en est donc
  propriétaire ; la protection n'y est pas posée. `apps/audit/test_journal_protection.py`
  prouve que le contrôle détecte cet état et accepte l'état protégé.
- **Docker** (`backend/docker-compose.yml`) : le script d'initialisation crée le compte
  applicatif propriétaire de la base ; après les migrations, exécuter
  `psql -h localhost -p 5433 -U keya_ecosystem_root -d keya_ecosystem_db -v app_role=keya_ecosystem_app -f backend/scripts/sql/protect_journal.sql`.
- **Render (hébergement de démonstration)** : **non appliqué**. Le compte fourni par Render n'est,
  a priori, pas superutilisateur (non vérifié dans cette session) ; la faisabilité (création d'un rôle
  sans connexion, transfert de propriété) est **à vérifier avant tout déploiement**, sur
  accord du PO. À défaut, un dispositif compensatoire est à faire approuver (CDC §11).
  **Simulation locale du 30/09** (PostgreSQL 16, compte unique comme sur Render) : posée par ce seul
  compte, la protection est inopérante — le compte qui crée le rôle propriétaire en garde le droit
  d'administration et peut se le réattribuer. Option validée au niveau SQL : compte d'exécution
  restreint pour l'application, le compte Render restant propriétaire. Voir
  `docs/exploitation/PROCEDURE_VERIFICATION_RENDER_T15_T16.md`.
- Ce que cet ADR ne promet pas (CDC §10) : l'immutabilité absolue de l'infrastructure. Un
  superutilisateur ou le propriétaire du journal peut toujours le modifier ; ces comptes ne
  sont pas ceux de l'application.
