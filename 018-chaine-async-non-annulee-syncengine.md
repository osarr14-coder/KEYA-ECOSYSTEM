# Ticket 018 — Chaîne asynchrone non annulée dans `startSyncEngine`

## Statut
Livré. Corrige une dette technique repérée (mais volontairement laissée hors scope,
faute d'impact démontré) au ticket 016. Aucune nouvelle fonctionnalité. Premier ticket
de la branche `feature/frontend-improvements`.

## Objectif
`startSyncEngine` (`apps/control-pwa/src/sync/syncEngine.ts`) retourne une fonction
d'arrêt (`stop()`), appelée au démontage de `<App />`. Une fois appelée, plus aucun
cycle de synchronisation ne doit s'exécuter — y compris un cycle déjà lancé mais pas
encore terminé au moment de l'arrêt.

## Contexte
`runIfOnline` vérifie `stopped` avant de LANCER un cycle, mais jamais après :

```ts
function runIfOnline() {
  if (stopped || !navigator.onLine) return;
  void refreshMissions(apiClient).then(() => runSyncCycle(apiClient));
}
```

Si `stop()` est appelé PENDANT que `refreshMissions(...)` est encore en vol (composant
démonté en plein cycle réseau, ou navigation qui déclenche un remontage React avant
qu'une réponse lente n'arrive), le `.then(() => runSyncCycle(apiClient))` s'exécute
quand même une fois la réponse arrivée — `runSyncCycle` peut alors lire/écrire
IndexedDB et déclencher de vrais appels réseau (`syncDraft`) après que l'arrêt a
pourtant été explicitement demandé.

Repéré en marge du ticket 016 (« Explicitement hors scope » : « latence de nettoyage
préexistante… sans impact démontré sur un cas réel »). Aucune duplication de données
n'avait alors été observée en pratique — mais rien ne garantit que ça reste vrai (ex.
StrictMode en dev, changement de route qui démonte/remonte l'app, tests futurs plus
agressifs sur le timing réseau) : le correctif est peu coûteux, autant fermer le trou
plutôt que de compter sur l'absence de preuve.

## Correction
`stopped` revérifié dans le `.then(...)` lui-même, avant d'appeler `runSyncCycle` :

```ts
void refreshMissions(apiClient).then(() => {
  if (stopped) return undefined;
  return runSyncCycle(apiClient);
});
```

Minimal et suffisant : `stopped` est déjà la source de vérité utilisée par la garde
d'entrée de `runIfOnline`, il suffit de la relire au bon moment plutôt que d'introduire
un nouveau mécanisme (`AbortController`, flag dédié...).

## Test de reproduction
`syncEngine.test.ts`, nouveau describe block — confirmé rouge puis vert :
1. Un brouillon `pending` avec décision déjà saisie est seedé (s'il se synchronise, il
   déclenche un VRAI second appel réseau observable — la preuve n'est jamais une
   supposition sur l'état interne du moteur).
2. `startSyncEngine` démarré en ligne : `runIfOnline()` s'exécute immédiatement,
   `listMissions` est appelé (mocké avec une promesse tenue manuellement, jamais
   résolue tout de suite).
3. `stop()` appelé PENDANT que cette promesse est encore en attente — reproduit
   exactement le chevauchement visé.
4. La promesse `listMissions` n'est résolue qu'APRÈS `stop()`.
5. Le event loop reçoit plusieurs tours réels (`setTimeout(0)` en boucle — jamais une
   durée devinée, juste assez de tours pour laisser une chaîne UNIQUE, non concurrencée,
   se dérouler jusqu'au bout à travers plusieurs lectures/écritures IndexedDB réelles) ;
   `Promise.resolve()` seul ne suffit pas ici, IndexedDB (même via le polyfill de test)
   résout via de vraies tâches de la file d'attente, pas seulement des microtasks.
6. Assertion : un seul appel réseau au total (`listMissions`), jamais un second vers
   `/control/sync/inspection/` — avant correction : 2 appels observés ; après : 1.

## Critères d'acceptation
- [x] `stop()` appelé pendant qu'un cycle est en vol empêche `runSyncCycle` de
      s'exécuter une fois la promesse résolue — testé par reproduction déterministe
      (aucun `sleep` à durée devinée)
- [x] Comportement normal (pas d'arrêt) inchangé — confirmé par les 14 autres tests du
      même fichier, tous toujours verts
- [x] Suite complète frontend verte (127 tests, 4 workspaces — 126 + 1 nouveau)

## Explicitement hors scope
- Tout mécanisme d'annulation plus général (`AbortController` sur les vraies requêtes
  `fetch` en vol) — non nécessaire ici : le problème n'est pas qu'une requête réseau
  continue de tourner après `stop()` (elle se termine normalement, sans conséquence en
  elle-même), seulement que SA SUITE (`runSyncCycle`) ne doit plus s'exécuter

## Dépendances
Ticket 010 (CONTROL PWA, `startSyncEngine`), ticket 016 (dette initialement repérée et
volontairement laissée de côté).
