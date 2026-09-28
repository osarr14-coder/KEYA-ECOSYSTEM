# Réactivation du mode hors ligne de l'app Contrôle — prérequis

> Décision PO-2026-09-28-39. Document de préparation : **rien n'est réactivé**.
> Dans le MVP, le hors ligne est coupé (K04, PO-2026-09-27-04) : la date serveur
> fait foi.

## État actuel (MVP)

| Élément | Où | État |
|---|---|---|
| Mode hors ligne de l'app | `apps/control-pwa/src/config.ts` — `OFFLINE_MODE_ENABLED` | `false` : brouillons IndexedDB, moteur de synchronisation et `InspectionFormView` conservés, jamais démarrés ni affichés. |
| Routes de synchronisation | `/api/control/sync/{documents,evidence,inspection}/` | Coupées par `KEYA_OFFLINE_SYNC_ENABLED` (faux par défaut, réponse « introuvable ») — PO-2026-09-28-30. Activées seulement dans `settings_test.py`, pour que leurs tests continuent d'exercer le code. |
| Tests du conflit de synchronisation (affichage du conflit ; « Ignorer ma saisie et recommencer ») | `apps/control-pwa/src/views/InspectionFormView.test.tsx` | Exécutés seulement si `OFFLINE_MODE_ENABLED` est vrai (`it.runIf`) — PO-2026-09-28-37 et PO-2026-09-28-58. Instables : voir prérequis 2. |
| Avis en ligne | `/api/control/missions/{id}/avis/` | Seule voie de l'app : mission affectée, versions désignées explicitement, date serveur. |

Réactiver le hors ligne suppose d'activer **les deux** réglages (app et serveur).
Aucun des deux ne doit l'être tant que les trois prérequis ci-dessous ne sont pas
remplis et testés.

## Prérequis

### 1. Garde d'affectation sur les routes de synchronisation

Aujourd'hui, les trois routes `sync` exigent le rôle Contrôleur, mais pas que la
mission soit **affectée à ce contrôleur**. Les routes en ligne l'exigent déjà :
liste, fiche, pièce, avis de mission et `POST /api/inspections/`
(`require_assigned_mission`, PO-2026-09-28-30).

À faire avant réactivation :

- `SyncInspectionView` : passer `require_assigned_mission=True` à
  `create_inspection` (via `apps.control.services.sync_inspection`), avec la
  même réponse « introuvable » (`MissionNotAssigned` → 404).
- `SyncEvidenceView` : refuser une pièce rattachée à une déclaration sans
  mission affectée au contrôleur.
- `SyncDocumentView` : refuser un dépôt dans une organisation où le contrôleur
  n'a aucune mission affectée ; idéalement, rattacher le document à une
  mission dès le dépôt.
- Désignation explicite des versions examinées (PO-2026-09-28-20) : déjà
  exigée par la voie `sync`. À vérifier côté app, car le formulaire hors ligne
  doit faire cocher les versions comme la fiche en ligne.
- Test : étendre `TestInspectorActsOnlyOnAssignedMissions`
  (`apps/sales/test_audit_ui_r1_step7.py`) aux trois routes `sync`, réglage
  activé.

### 2. Isolation IndexedDB du test de conflit

Cause diagnostiquée (PO-2026-09-28-23) : une écriture IndexedDB lancée par un
test précédent se termine **après** `clearIndexedDB()`. C'est par exemple le cas
d'un ajout ou d'une suppression de photo dans un `InspectionFormView` démonté.
Il reste alors deux brouillons pour `mission-1`, et `getFromIndex('by-mission')`
renvoie l'ancien. Le test échoue environ une fois sur huit sous charge.

À faire avant réactivation :

- attendre la fin des écritures en cours avant le nettoyage : suivre les
  promesses d'écriture du dépôt (`db/repository.ts`) et les attendre dans
  `afterEach`, ou ouvrir une base IndexedDB distincte par test ;
- démonter explicitement les vues (`cleanup()`) avant `clearIndexedDB()` ;
- retirer alors les deux marqueurs `it.runIf(OFFLINE_MODE_ENABLED)` et vérifier
  30 exécutions consécutives sans échec, en parallèle et sous charge.

### 3. Date de saisie et date serveur affichées

Hors ligne, la saisie précède l'enregistrement. Le CDC et K04 exigent que la
date serveur fasse foi, sans masquer quand l'avis a réellement été saisi.

À faire avant réactivation :

- conserver la **date de saisie** sur l'appareil (brouillon, `captured_at`
  déjà prévu pour les pièces) et l'envoyer avec l'avis ;
- enregistrer la **date serveur** à la réception (`created_at`, qui seule fait
  foi pour les niveaux de confiance, les réserves et les décaissements) ;
- afficher **les deux** partout où l'avis apparaît : app Contrôle, BUILD,
  niveaux de confiance, chronologie du back-office. Par exemple : « Saisi le
  … sur l'appareil · enregistré le … (date serveur, GMT, Abidjan) » ;
- test : un avis synchronisé montre les deux dates, et seule la date serveur
  ordonne les événements.

## Réactivation (le jour venu)

1. Prérequis 1 à 3 livrés, tests verts.
2. Décision du Product Owner inscrite au journal (elle lève K04).
3. `KEYA_OFFLINE_SYNC_ENABLED=True` côté serveur, puis
   `OFFLINE_MODE_ENABLED = true` côté app.
4. Recette du parcours hors ligne (coupure réseau, saisie, retour du réseau,
   conflit) avant toute démonstration.
