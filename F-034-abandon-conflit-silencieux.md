# Ticket F-034 — Échec silencieux d'abandon d'une saisie en conflit (CONTROL PWA)

## Statut
Livré (branche `feature/frontend-round-2`).

## Contexte

Ticket de suivi direct de F-033 (audit des états système, vague 4) : lors
de l'audit initial, deux occurrences de la même classe de bug avaient été
trouvées dans `InspectionFormView.tsx` (CONTROL PWA) — un échec IndexedDB
jamais catché, devenant une rejection non gérée plutôt qu'un signal visible
pour l'inspecteur. La première (`persist()`) a été corrigée dans F-033
vague 4 (sévérité jugée haute — la file d'écriture entière restait
poisonnée après un seul échec, silencieusement, jusqu'à la fermeture de
l'app). La seconde (`resolveConflictByDiscarding`) avait été volontairement
laissée hors de F-033 — sévérité jugée plus faible à l'audit (« pas d'état
trompeur, l'inspecteur peut simplement recliquer »), documentée comme dette
explicite plutôt que corrigée dans la précipitation.

Ce ticket ferme cette dette : même classe de bug, même correctif que
`persist()`, appliqué à `resolveConflictByDiscarding`.

## Défaut corrigé

`resolveConflictByDiscarding()` (bouton « Ignorer ma saisie et
recommencer », affiché sur le bandeau « Conflit à résoudre ») appelait
`deleteDraft(draft.id)` sans aucun `try/catch` : un échec IndexedDB (quota
dépassé, base bloquée par une mise à jour de version, navigation privée...)
devenait une rejection non gérée — le clic de l'inspecteur semblait ne rien
faire, sans le moindre signal, le bandeau de conflit restant affiché tel
quel sans explication.

**Différence de sévérité avec `persist()`, confirmée avant implémentation**
: `resolveConflictByDiscarding` est une action ponctuelle, pas une file
d'écriture partagée — un échec ne poisonne aucun état partagé (contrairement
à `persistChainRef` avant son propre correctif), et le bandeau de conflit +
le bouton restent tous deux affichés après un échec (rien ne les fait
disparaître), donc techniquement recliquables sans navigation supplémentaire.
C'est pourquoi l'audit F-033 avait initialement classé ce cas en sévérité
faible. Mais l'absence de feedback explicite et la rejection non gérée
restent un défaut réel — d'où ce ticket, avec le même mécanisme de
correctif que `persist()` par cohérence, même si la mécanique de retry est
plus simple ici (voir ci-dessous).

## Correctif

Même mécanisme que `persist()`/`retryPersist()` (F-033 vague 4) :
- Portillon EXPLICITE en état React (`resolveConflictError`), jamais une
  promesse rejetée silencieusement — `resolveConflictByDiscarding()` catche
  désormais l'échec et pose ce portillon plutôt que de laisser la rejection
  se propager sans être gérée.
- Bandeau `AlertBanner` dédié (« Échec de l'abandon de la saisie. »),
  affiché en sibling du bandeau « Conflit à résoudre » (jamais imbriqué
  dans un autre `AlertBanner` — deux régions `role="alert"` imbriquées
  auraient été un problème d'accessibilité), avec un bouton « Réessayer »
  via `onRetry`/`retryLabel` (mêmes props qu'`AlertBanner` depuis la vague
  3 de F-033).

**Différence assumée avec `retryPersist()`** : pas de logique de fusion
d'état accumulé pendant la panne. `deleteDraft` + `createEmptyDraft` est
une action **idempotente** qui ne dépend d'aucune saisie intermédiaire —
rejouer **exactement la même fonction** (`resolveConflictByDiscarding`)
suffit comme retry, contrairement à `persist()` où un retry naïf aurait
perdu les saisies accumulées entre l'échec et le clic sur « Réessayer ».
Aucun second chemin d'écriture parallèle introduit — même discipline que
`persist()`.

## Tests

Écrits AVANT d'accepter le correctif comme terminé, confirmés ROUGES contre
le code non corrigé (vérifié en isolant temporairement le correctif du
fichier via `git stash`, puis en le restaurant) — l'échec observé est
littéralement une **rejection non gérée** (`Unhandled Rejection:
QuotaExceededError`), preuve directe du défaut décrit :

1. Un échec de `deleteDraft` affiche le nouveau bandeau, jamais de rejection
   non gérée — le bandeau « Conflit à résoudre » et la saisie en conflit
   (commentaire, décision) restent intacts, rien n'est perdu.
2. Réessayer après un échec (mock reprenant le comportement réel) repart
   bien d'un formulaire vierge — preuve que le retry n'est pas bloqué
   indéfiniment sur le même échec.

2 nouveaux tests, `apps/control-pwa` : 22 → 24. **425 tests frontend**
(5 packages : 64+75+73+55+158), zéro régression (2 exécutions consécutives
propres de la suite complète), `tsc --noEmit` propre.

## Vérification en navigateur réel

Pas de vérification en navigateur réel, décision assumée — même rationale
que les correctifs précédents de cette même classe (`persist()`, F-033
vague 4) : provoquer un VRAI échec `deleteDraft` exige une vraie panne
IndexedDB, plus fiable à reproduire de façon déterministe via `vi.spyOn`
que par une manipulation manuelle de navigateur.

## Dépendances
Aucune — ticket purement frontend, `apps/control-pwa` uniquement, zéro
changement backend.
