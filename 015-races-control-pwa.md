# Ticket 015 — Deux races de concurrence dans CONTROL PWA

## Statut
Livré. Corrige deux races découvertes en documentant/relisant le parcours du
ticket 013 (aucune des deux n'était le bug corrigé par ce ticket-là, mais le
même code — `syncEngine.ts`/`InspectionFormView.tsx` — les rendait
possibles). Aucune nouvelle fonctionnalité.

## Objectif
Corriger deux races de concurrence réelles dans `apps/control-pwa`, chacune
reproduite par un test déterministe AVANT correction (jamais un `sleep`
hasardeux), puis vérifiées closes par un parcours manuel en navigateur.

## Bugs corrigés

### 1. Cycles de synchro périodiques qui se chevauchent
`startSyncEngine` (`src/sync/syncEngine.ts`) déclenche `runSyncCycle` toutes
les 15s (`RETRY_POLL_INTERVAL_MS`) sans jamais attendre qu'un cycle
précédent soit terminé, ni vérifier qu'aucun n'est déjà en cours pour un
brouillon donné. Si un cycle réseau dépasse cet intervalle (upload photo
lent, backend lent...), le sondage suivant démarre un second cycle qui relit
le MÊME brouillon (encore `pending`/`syncing`) et le resynchronise en
parallèle — potentiellement avec un instantané périmé par rapport à celui
déjà en vol, et dans tous les cas un second appel réseau inutile pour la
même inspection.

**Corrigé** par un verrou PAR BROUILLON (`draftsInFlight`, un `Set<string>`
module-level) dans `syncDraft` — vérifié et posé EN TOUT PREMIER, avant tout
`await` : un second appel pour le même `draft.id` trouve donc toujours ce
verrou déjà posé (JS n'exécute jamais deux appels de fonction en parallèle,
aucune fenêtre de course possible pour le vérifier), et ne fait rien —
jamais une resynchro fantôme. Jamais un verrou global : d'autres brouillons
continuent de se synchroniser normalement pendant qu'un seul est retenu.

**Test de reproduction** (`syncEngine.test.ts`, décrit AVANT correction,
confirmé rouge puis vert) : deux appels `syncDraft(draft, apiClient())`
lancés dans le même argument de `Promise.all` — évalués séquentiellement
par le moteur JS jusqu'au premier `await` de chacun, donc déterministe sans
aucun délai artificiel. Avant correction : 2 appels réseau. Après : 1 seul,
et un second test confirme que deux brouillons DIFFÉRENTS continuent de se
synchroniser en parallèle (verrou bien par brouillon, jamais global).

### 2. `persist()` concurrents dans le formulaire d'inspection
`InspectionFormView.tsx` : upload photo et choix de décision presque
simultanés pouvaient s'écraser mutuellement. Cause **double**, confirmée en
reproduisant le bug avant correction :
1. **État React non atomique** : chaque gestionnaire (`handlePhotoAdd`,
   `handleDecisionChange`...) construisait son "next" à partir du `draft`
   figé dans la fermeture de son propre rendu, sans savoir qu'un autre
   gestionnaire venait de le modifier.
2. **Écritures IndexedDB non sérialisées** : `saveDraft` remplace
   intégralement l'enregistrement (`db.put`, jamais une fusion), et rien ne
   garantissait qu'une écriture lancée plus TÔT ne se termine pas plus TARD
   qu'une autre — l'écriture la plus ancienne pouvait alors écraser
   silencieusement la plus récente, aussi bien en IndexedDB qu'à l'écran.

**Corrigé** par deux mécanismes complémentaires dans `InspectionFormView`,
chacun réglant une des deux causes :
- `draftRef` (toujours la dernière valeur RÉELLEMENT connue, mise à jour de
  façon SYNCHRONE — jamais différée) : chaque `persist(mutate)` lit
  `draftRef.current`, jamais une fermeture de rendu périmée — règle (1).
- `persistChainRef` (chaîne de promesses) : l'écriture IndexedDB de chaque
  `persist` n'est lancée qu'une fois la précédente terminée — un
  `saveDraft` ne peut plus jamais en écraser un autre plus récent, quel que
  soit l'ordre dans lequel IndexedDB les termine en interne — règle (2). Un
  garde-fou supplémentaire (comparaison de référence `draftRef.current ===
  next`) ignore le résultat d'une écriture devenue périmée entre-temps,
  pour ne jamais régresser l'affichage même dans une fenêtre transitoire.
- La mise à jour optimiste (`setDraft`) reste SYNCHRONE, jamais déplacée
  derrière la file d'écriture — le critère d'acceptation central de la
  passe 1 du ticket 010 (« chaque saisie est écrite immédiatement ») reste
  intact, y compris à l'écran.

**Test de reproduction** (`InspectionFormView.test.tsx`, décrit AVANT
correction, confirmé rouge puis vert) : `saveDraft` intercepté (`vi.spyOn`)
pour mettre chaque écriture réelle en attente plutôt que de l'exécuter tout
de suite ; upload photo et clic décision déclenchés sans rien attendre
entre les deux ; les écritures interceptées sont résolues en ordre INVERSE
de leur arrivée (le pire ordre de résolution possible), en boucle jusqu'à
ce que les deux mutations logiques aient été émises — sans dépendre d'un
délai arbitraire, ni présumer si l'implémentation les traite en concurrence
ou en série. Avant correction : la décision était perdue
(`draft.decision === null`). Après : les deux changements survivent.

## Vérification manuelle en navigateur
Backend Django + CONTROL PWA (Vite, port 5173 — le port 5183 initialement
essayé n'est PAS dans `CORS_ALLOWED_ORIGINS`, corrigé en cours de route)
lancés localement, données réelles (organisation, lot, mission affectée à
un inspecteur) créées via les services backend, JWT inspecteur posé en
`localStorage`.

- **Bug 2** : upload d'une vraie photo puis clic immédiat sur « Réserve »,
  sans attendre entre les deux — lecture directe d'IndexedDB (pas
  seulement l'écran) après coup : `{"decision":"reserve","photoCount":1}`,
  les deux changements bien présents.
- **Bug 1** : un brouillon déjà synchronisé reposé à `pending` (simule un
  item retenté), puis deux évènements `online` déclenchés dos-à-dos sans
  rien attendre entre les deux (`window.dispatchEvent`) — un seul `POST
  /api/control/sync/inspection/` observé dans l'onglet réseau, jamais deux,
  malgré les deux cycles chevauchants réellement déclenchés.

## Critères d'acceptation
- [x] Un test reproduit chaque race de façon déterministe (chevauchement
      forcé explicitement) AVANT toute correction — vérifié rouge, puis
      vert après correction, pour les deux bugs
- [x] Un seul cycle de synchro actif à la fois PAR BROUILLON — d'autres
      brouillons continuent de se synchroniser en parallèle
      (`syncEngine.test.ts`)
- [x] La cause exacte de la race `persist()` est identifiée (état React non
      atomique ET écritures IndexedDB non sérialisées — les deux, pas l'un
      ou l'autre) avant correction, documentée dans le code et ce fichier
- [x] Upload photo et choix de décision presque simultanés conservent les
      DEUX changements, y compris en IndexedDB (pas seulement à l'écran)
- [x] Parcours manuel en navigateur confirmant que les deux scénarios
      découverts ne se reproduisent plus
- [x] Suite complète backend (180 tests, inchangée) et frontend (122
      tests, 4 workspaces) intégralement vertes

## Explicitement hors scope
- Fusion/arbitrage lors d'un conflit de synchronisation serveur (ADR 0002,
  décision déjà actée au ticket 010 passe 2) — sans rapport avec ces
  races, qui sont strictement côté client
- Toute autre race potentielle non découverte pendant le parcours du
  ticket 013

## Dépendances
Tickets 010 (CONTROL PWA, passes 1 et 2), 013 (parcours qui a révélé ces
deux races).
