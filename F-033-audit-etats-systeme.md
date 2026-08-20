# Ticket F-033 — Audit des états système (doctrine 17.5 V3.0)

## Statut
En cours, par vagues. **Vagues 1, 2, 3 livrées, et `persist()` silencieux
de la vague 4 livré** (branche `feature/frontend-round-2`). Reste de la
vague 4 (permission denied dédiée, `sync failed` par photo CONTROL PWA,
`resolveConflictByDiscarding`, stale data) toujours à prioriser avec
l'utilisateur — non commencé.

## Étape 1 — audit exhaustif (aucune correction), livré et discuté

Tous les écrans admin d'`apps/web` et les 3 apps (HOME/BUILD/CONTROL PWA)
lus intégralement. Tableau complet (écran × état pertinent ×
géré/manquant/à vérifier) livré en conversation. Constats transversaux
majeurs : `offline` n'avait de détection réelle que dans CONTROL PWA ;
`permission denied` n'avait un vrai état dédié qu'au gate `admin_keyimmo`
d'`apps/web` ; aucun bouton « Réessayer » nulle part ; `sync failed` par
photo tracké en données mais jamais affiché.

## Vague 1 (déjà livrée séparément)
Voir la section CLAUDE.md dédiée — deux bugs de robustesse IndexedDB
corrigés dans `MissionsListView`/`InspectionFormView` (CONTROL PWA).

## Vague 2 — détection réseau hors CONTROL PWA

**État des lieux vérifié avant tout code (demande explicite)** :
`apps/control-pwa/src/App.tsx::useOnlineStatus()` était un hook LOCAL, non
exporté, non partagé (~15 lignes — `navigator.onLine` + listeners
`online`/`offline`). `packages/design-system/src` ne contenait AUCUN hook
logique, seulement des composants visuels + tokens.

**Décision initiale proposée puis CORRIGÉE par l'utilisateur avant
implémentation** : j'avais d'abord proposé de dupliquer ce hook par app
(par analogie avec `createApiClient`/`useApiResource`, déjà dupliqués).
L'utilisateur a rappelé la règle constante du projet (« toujours
réutiliser, jamais redéfinir », déjà appliquée à `CountryPackSelector`
ticket F-030, `StatusBadge`/`AppShell` ticket 007) : `useOnlineStatus` est
un hook PUREMENT générique, sans rien de spécifique à une app — il doit
avoir UNE SEULE implémentation, dans `packages/design-system`, jamais
copiée-collée.

**Réalisé** : `packages/design-system/src/hooks/useOnlineStatus.ts` (+ 4
tests), exporté depuis `index.ts` — premier hook du package (jusque-là
uniquement composants/tokens). CONTROL PWA (`App.tsx`) importe désormais
CETTE implémentation au lieu de sa copie locale, retirée. HOME/BUILD/
`apps/web` (`App.tsx`, un seul montage par shell) l'importent aussi,
réutilisant `AlertBanner` (déjà partagé) pour le bandeau « Hors ligne » —
texte volontairement DIFFÉRENT de celui de CONTROL PWA (« Vos saisies sont
enregistrées... seront synchronisées ») : ces 3 apps n'ont AUCUNE file
locale/offline-first, un message promettant une synchronisation
automatique serait FAUX pour elles. Message retenu : « Les actions
nécessitant le réseau échoueront tant que la connexion n'est pas
rétablie. ». `apps/web` couvre à la fois l'écran de connexion et le
back-office authentifié (un seul point d'insertion, dans `App()`).

## Vague 3 — bouton « Réessayer » sur les erreurs génériques

**Mécanisme retenu** : `AlertBanner` (design-system) gagne deux props
optionnelles `onRetry?`/`retryLabel?` — rétrocompatible, absent par défaut
(la plupart des `AlertBanner` ne sont PAS des erreurs de chargement
génériques : formulaires déjà retentables via leur propre bouton,
bandeaux informationnels, conflit avec sa propre action dédiée,
« Accès refusé » où réessayer ne change rien).

`useApiResource` (dupliqué dans `apps/{home,build,web}`) gagne un
`refetch()` — un compteur interne (`reloadToken`) inclus dans les deps de
l'effet EN PLUS de celles fournies par l'appelant, sans changer leur
contrat. Nouveau type exporté `ApiResourceState<T> = ResourceState<T> &
{ refetch: () => void }`, utilisé aussi comme type de prop partout où un
état de ressource est passé en enfant (`LegalPaymentTiersView::
ActiveTemplatePanel`, seul cas trouvé dans tout le projet).

**Deux mécanismes de recherche NE PASSENT PAS par `useApiResource`** —
retry implémenté séparément, même principe (compteur inclus dans les
deps) :
- `BackofficeView::handleSearch` (déclenché par soumission de formulaire,
  pas un effet) — extrait en `runSearch()` (sans `FormEvent`), appelé à
  la fois par le formulaire et le bouton Réessayer.
- `DevisView::useDebouncedSearch` (utilisé par `LotPicker`/
  `OrganizationPicker`) — gagne un `reloadToken` dans ses propres deps
  d'effet ; le retry passe TOUJOURS par le même debounce (250ms,
  imperceptible), jamais un second chemin direct qui contournerait les
  gardes anti-course déjà en place (`cancelled`/`latestQueryRef`).

**CONTROL PWA — les 2 banners ajoutés en vague 1** (`MissionsListView`/
`InspectionFormView`, IndexedDB direct, pas `useApiResource`) suivent le
MÊME traitement : compteur `reloadToken` local à chaque fichier, inclus
dans les deps de leur effet de montage.

**Incohérence corrigée au passage, pas silencieusement smuggled** :
`HOME`/`BUILD::App.tsx` utilisaient un `<p role="alert">` brut au lieu
d'`AlertBanner` pour l'erreur de `/me` — déjà notée comme dette à l'audit
(étape 1). Puisque ces exactes lignes devaient de toute façon être
modifiées pour ajouter le retry (même défaut — erreur de chargement
générique — que toutes les autres cibles de cette vague), corrigé en même
temps plutôt que d'ajouter un bouton "Réessayer" à un `<p>` et laisser
l'incohérence stylistique en place.

## Enumération complète — 20 sites câblés avec retry

`grep` exhaustif de tous les `<AlertBanner>` du projet (~37 occurrences
avant ce ticket) : 20 sites correspondent à une erreur de chargement
générique, câblés avec `onRetry` ; les ~17 restants (erreurs de
soumission de formulaire déjà retentables via leur propre bouton,
bandeaux informationnels, conflit CONTROL PWA, « Accès refusé », export
CSV volumineux) laissés INTACTS délibérément — ajouter un retry y aurait
été redondant ou dénué de sens.

| Site | Mécanisme |
|---|---|
| `apps/web/App.tsx` (`meState`, back-office) | `useApiResource.refetch` |
| `apps/web/CountryPackSelector.tsx` | `useApiResource.refetch` |
| `apps/web/BackofficeView.tsx` — recherche | `runSearch()` extrait |
| `apps/web/BackofficeView.tsx` — profil (`UserDetailPanel`) | `useApiResource.refetch` |
| `apps/web/DevisView.tsx` — recherche lot (`LotPicker`) | `useDebouncedSearch.retry` |
| `apps/web/DevisView.tsx` — `DevisListPanel` | `useApiResource.refetch` |
| `apps/web/DevisView.tsx` — `AjustementsPanel` | `useApiResource.refetch` |
| `apps/web/PricingView.tsx` — taux actuels | `useApiResource.refetch` |
| `apps/web/PricingView.tsx` — historique (×1 composant, ×2 canaux) | `useApiResource.refetch` |
| `apps/web/LegalPaymentTiersView.tsx` — template actif | `useApiResource.refetch` |
| `apps/web/LegalPaymentTiersView.tsx` — historique | `useApiResource.refetch` |
| `apps/home/App.tsx` (`meState`) | `useApiResource.refetch` + `<p>`→`AlertBanner` |
| `apps/home/App.tsx` (`lotsState`) | `useApiResource.refetch` + `<p>`→`AlertBanner` |
| `apps/home/OverviewView.tsx` | `useApiResource.refetch` |
| `apps/home/EvidenceFeedView.tsx` | `useApiResource.refetch` |
| `apps/home/MyActionsView.tsx` | `useApiResource.refetch` |
| `apps/home/PriorityTaskSummary.tsx` | `useApiResource.refetch` |
| `apps/build/App.tsx` (`meState`) | `useApiResource.refetch` + `<p>`→`AlertBanner` |
| `apps/build/ExceptionsView.tsx` | `useApiResource.refetch` |
| `apps/build/AllLotsView.tsx` | `useApiResource.refetch` |
| `apps/control-pwa/MissionsListView.tsx` | `reloadToken` local |
| `apps/control-pwa/InspectionFormView.tsx` | `reloadToken` local |

(`OrganizationPicker` de `DevisView` partage le MÊME `useDebouncedSearch`
que `LotPicker` — mécanisme déjà prouvé, pas dupliqué en test séparé.)

## Vérification

**376 tests frontend** (5 packages : design-system 51, build 68,
control-pwa 61, home 48, web 148), zéro régression, `tsc --noEmit` propre
partout. Suite relancée deux fois pour confirmer la stabilité (aucun
flake observé sur ce tour — le flake IndexedDB déjà documenté de
`InspectionFormView.test.tsx` avait été observé UNE fois lors du premier
run de suite complète après ces changements, non reproductible en
isolation ni au rerun suivant — même classe déjà connue, pas causé par ce
ticket).

**Vérifié dans un vrai navigateur, avec un vrai backend** (compte
`admin_keyimmo` réel) :
- bandeau « Hors ligne » affiché sur l'écran de connexion (avant
  authentification) ET sur le back-office authentifié, en simulant
  `navigator.onLine = false` + événement `offline` ;
- recherche back-office avec un échec réseau simulé (`fetch` intercepté
  pour rejeter le premier appel) → bouton « Réessayer » affiché → clic →
  résultat réel affiché, sans rechargement de page.

## Vague 4 (partielle) — `InspectionFormView::persist()`, échec d'écriture silencieux

**État des lieux vérifié avant toute proposition (demande explicite)** :
tracé le mécanisme exact plutôt que de supposer qu'un `catch` suffirait.
`persist()` découple la mise à jour optimiste (synchrone, toujours
affichée) de l'écriture IndexedDB (mise en file via `persistChainRef`).
Avant ce correctif, une SEULE écriture en échec (quota dépassé, IndexedDB
bloquée par une mise à jour de version, navigation privée...) laissait
`persistChainRef.current` sur une promesse REJETÉE — chaque `persist()`
suivant, `queue.then(onFulfilled)` sur une promesse déjà rejetée ne
s'exécutant JAMAIS, devenait un no-op d'écriture PERMANENT et SILENCIEUX :
la saisie continuait de s'afficher normalement à l'écran, mais plus rien
n'était plus jamais réellement enregistré, jusqu'à la fermeture de l'app.

**Pourquoi « juste un catch » ne suffisait pas** : un retry naïf qui
rejoue uniquement la DERNIÈRE mutation sur la base lue en IndexedDB
(périmée depuis la panne) perdrait silencieusement toutes les saisies
faites ENTRE-TEMPS. Le retry doit sauvegarder l'état COMPLET actuellement
en mémoire (`draftRef.current`), jamais une mutation isolée — exactement
ce qui distingue ce correctif d'un simple `catch`, et ce qui a été montré
à l'utilisateur avant tout code.

**Contrainte explicite de l'utilisateur, vérifiée avant de committer** :
le retry ne doit PAS créer un second chemin d'écriture parallèle, sous
peine de réintroduire la classe de race déjà corrigée au ticket 015.
Résolu en utilisant un état React `persistError` comme portillon EXPLICITE
dans `persist()` lui-même (plutôt que de s'appuyer sur la promesse
rejetée) : la chaîne interne catche désormais sa propre erreur (`.catch`
→ `setPersistError(true)`, RÉSOUT au lieu de rejeter), donc
`persistChainRef.current` reste TOUJOURS une promesse SAINE — c'est
`persistError`, pas l'état de la promesse, qui empêche les tentatives
d'écriture individuelles suivantes. `retryPersist()` s'enchaîne sur cette
MÊME `persistChainRef`/`draftRef`, jamais un chemin séparé — les deux
fonctions ne peuvent jamais écrire en même temps (persist() se met en
pause via `persistError` dès qu'une panne est connue, seul `retryPersist`
écrit tant qu'elle dure).

**Nouveau bandeau** (`AlertBanner`, réutilisant `onRetry`/`retryLabel` de
la vague 3) : « Échec de l'enregistrement local. » + « Réessayer
l'enregistrement » — distinct du bandeau « Conflit » existant (deux
problèmes réellement indépendants, coexistence possible).

**Tests écrits AVANT correction** (confirmés ROUGES — 4 rejets non gérés
observés en conditions réelles avant tout changement de code de
production) : bandeau affiché sur échec (saisie optimiste jamais annulée
à l'écran) ; **preuve directe contre un retry naïf** — deux saisies
DIFFÉRENTES faites pendant la panne, un seul clic sur « Réessayer »
enregistre les DEUX, jamais seulement la dernière ; un échec au retry
laisse le bandeau réessayable à volonté ; après un retry réussi, la file
n'est pas restée bloquée (une saisie suivante s'enregistre normalement).

**Flake IndexedDB préexistant, déjà documenté (ticket 026), rencontré
en testant — PAS causé par ce correctif** : le nouveau test « après un
retry réussi... » échouait de façon intermittente en suite complète
(jamais en isolant le fichier, ni en isolant ce seul test) — exactement
la même classe déjà documentée pour ce fichier (« dette de fiabilité
résiduelle », ticket 026). Investigation menée avant d'accepter cette
explication : le test isolé passait de façon fiable (confirmant la LOGIQUE
correcte), seule la version en suite complète échouait — un timeout de
`waitFor` porté à 3000ms (au lieu du défaut 1000ms) a stabilisé CE test ;
un run suivant a ensuite fait échouer un AUTRE test préexistant et
NON-MODIFIÉ de ce même fichier (« un conflit... affiche le conflit et la
saisie locale intacte », déjà nommément documenté comme flaky au ticket
026), confirmant qu'il s'agit bien du même défaut systémique du fichier
(contention IndexedDB sous suite complète), pas d'un bug introduit ici.
Non corrigé (hors scope de ce correctif) — la fréquence semble avoir
augmenté avec le volume croissant de tests dans ce fichier au fil des
tickets ; à surveiller, candidat à un ticket dédié si la gêne devient
réelle.

**23 tests `apps/control-pwa`** ajoutés au total sur la session
(`InspectionFormView.test.tsx` : 16 → 20, +4). **380 tests frontend** (5
packages : 51+68+65+48+148), `tsc --noEmit` propre partout.

**Pas de vérification en navigateur réel pour ce correctif, décision
assumée** (même rationale que la vague 1) : purement additif, la seule
façon de provoquer la nouvelle branche d'erreur est un VRAI échec
d'écriture IndexedDB — les tests automatisés (qui interceptent précisément
`saveDraft` via `vi.spyOn`) reproduisent ce scénario de façon plus
déterministe qu'une manipulation manuelle de navigateur.

## Explicitement hors vague 4 (reste à prioriser)

- États `permission denied` dédiés au-delà du gate `admin_keyimmo`
  d'`apps/web`.
- `sync failed` par photo (`LocalPhoto.mediaSyncStatus === 'failed'`)
  jamais affiché dans `PhotoThumbnail`.
- `resolveConflictByDiscarding` — même absence de `catch` que `persist()`
  avait, sévérité faible (pas d'état trompeur, l'inspecteur peut
  simplement recliquer).
- Stale data (`OverviewView`, missions/`knownLatestEventId` CONTROL PWA).

## Dépendances
Aucune — ticket purement frontend, `packages/design-system` +
`apps/{home,build,control-pwa,web}`, zéro changement backend.
