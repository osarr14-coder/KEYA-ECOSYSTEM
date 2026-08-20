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
en testant, corrigé sans toucher au fichier lui-même — PAS causé par ce
correctif** : le nouveau test « après un retry réussi... » échouait de
façon intermittente en suite complète (jamais en isolant le fichier) —
exactement la même classe déjà documentée pour ce fichier (« dette de
fiabilité résiduelle », ticket 026). Investigation poussée avant
d'accepter une explication superficielle (« juste plus lent ») : un
timeout `waitFor` porté à 3000ms n'a PAS suffi ; porté à 8000ms (avec le
timeout du test lui-même étendu en conséquence), le test restait bloqué
INDÉFINIMENT dans certains runs — preuve que ce n'était pas une question
de lenteur mais d'un blocage réel. Tracé explicitement (logs temporaires,
retirés après diagnostic) : le bandeau d'échec ne réapparaissait JAMAIS
pendant l'attente (excluant une vraie seconde panne applicative), et le
mécanisme `persist()`/`retryPersist()` lui-même s'est révélé correct par
relecture — la CAUSE RÉELLE identifiée : le test vérifiait la persistance
via une **nouvelle lecture IndexedDB** (`getDraftForMission`, une
connexion supplémentaire), un 3ᵉ aller-retour de connexion dans ce même
test (échec initial mocké, retry réel, cette vérification) qui exposait
directement la dette de fiabilité déjà documentée du fichier, plutôt que
la simple révéler par hasard. **Corrigé en changeant la méthode de
vérification, pas en attendant plus longtemps** : le test vérifie
désormais que `saveDraft` (l'espion) est bien rappelé après le retry — un
signal SYNCHRONE à l'appel, sans ouvrir de connexion IndexedDB
supplémentaire pour le constater. Stable sur 5 exécutions consécutives de
la suite complète après ce changement (0 échec). Fichier
`InspectionFormView.test.tsx` non modifié par ailleurs — la dette de
fiabilité résiduelle qu'il porte reste entière, seulement plus exposée
par ce nouveau test.

**23 tests `apps/control-pwa`** ajoutés au total sur la session
(`InspectionFormView.test.tsx` : 16 → 20, +4). **380 tests frontend** (5
packages : 51+68+65+48+148), `tsc --noEmit` propre partout.

**Pas de vérification en navigateur réel pour ce correctif, décision
assumée** (même rationale que la vague 1) : purement additif, la seule
façon de provoquer la nouvelle branche d'erreur est un VRAI échec
d'écriture IndexedDB — les tests automatisés (qui interceptent précisément
`saveDraft` via `vi.spyOn`) reproduisent ce scénario de façon plus
déterministe qu'une manipulation manuelle de navigateur.

## `sync failed` par photo, désormais affiché (ticket F-033, vague 4)

`LocalPhoto.mediaSyncStatus` (`pending/syncing/synced/failed`) était
tracké et mis à jour par `syncEngine.ts::syncPhotos` (backoff exponentiel,
jamais d'abandon — ticket 010 passe 2) depuis le début, mais jamais lu par
`PhotoThumbnail` : une photo bloquée en échec restait visuellement
identique à une photo synchronisée, sans aucun signal, même après
plusieurs tentatives automatiques.

**`StatusDot`, nouveau composant interne partagé** (`components/
StatusDot.tsx`) — extrait de `SyncStatusIndicator` (ticket 010) au moment
où un second consommateur réel apparaît avec la même forme (pastille +
libellé) mais un domaine de valeurs distinct : `PhotoSyncStatusIndicator`
(`MediaSyncStatus`, avec `failed` plutôt que `conflict` — aucune notion de
conflit ne s'applique à un simple upload de fichier). `SyncStatusIndicator`
délègue désormais son rendu à `StatusDot`, comportement observable
strictement inchangé (mêmes `data-testid`/`data-status`/libellés, ses 4
tests existants passent sans modification).

**Libellé `failed` honnête sur le comportement réel** : « Échec d'envoi —
nouvelle tentative automatique », pas un « échec » qui laisserait croire à
un blocage définitif — contrairement au bandeau d'échec d'enregistrement
local (portillon `persistError`, action explicite requise), aucune action
de l'inspecteur n'est nécessaire ici, le moteur de synchro retente déjà
seul indéfiniment.

**Piège de test rencontré, même famille que celui déjà documenté pour le
retry `persist()` ci-dessus** : un premier test ("En attente d'envoi" via
l'UI) ne patientait pas la fin RÉELLE de l'écriture IndexedDB avant de se
terminer (`findByText` résout dès la mise à jour optimiste, avant même que
la file d'écriture sérialisée touche IndexedDB) — l'écriture pouvait alors
se terminer APRÈS le `clearIndexedDB()` du test suivant, contaminant sa
lecture (`getDraftForMission` retrouvait le brouillon `pending` du test
précédent plutôt que celui explicitement sauvegardé en `failed`). Corrigé
en attendant explicitement la persistance réelle (`waitFor` + relecture
DB) avant la fin du test, même discipline que les tests préexistants de ce
fichier (ticket 010).

**8 nouveaux tests** (`PhotoSyncStatusIndicator.test.tsx` : 4 ; 2 tests
d'intégration dans `InspectionFormView.test.tsx`, un via l'UI, un en
préchargeant un brouillon avec une photo `failed`). **386 tests frontend**
(5 packages : 51+68+71+48+148), zéro régression, `tsc --noEmit` propre.

**Pas de vérification en navigateur réel, décision assumée** (même
rationale que ci-dessus) : provoquer un VRAI échec d'upload photo exige un
rejet serveur reproductible, moins fiable à déclencher manuellement que via
`vi.spyOn` sur le client API.

## `permission denied` distinct du reste, 401 vs 403 (ticket F-033, vague 4)

Avant ce correctif, un 401 (session expirée/compte désactivé mid-session,
ticket 011) ou un 403 (permission refusée, session valide) tombaient TOUS
LES DEUX dans le même message générique « Impossible de charger X. » +
bouton Réessayer que toute autre erreur de chargement — inutile dans les
deux cas (un jeton mort ou un droit manquant ne se corrige jamais par un
nouvel essai identique), et le seul état `permission denied` réellement
dédié du projet restait le gate `admin_keyimmo` d'`apps/web`, basé sur les
rôles de `/me`, jamais sur un statut HTTP réel.

**Décision produit validée avant implémentation** (le 401 pouvait rester un
simple message visible, ou déclencher une vraie déconnexion) : un 401 EN
COURS DE SESSION déclenche désormais une déconnexion AUTOMATIQUE (jeton
effacé, redirection vers l'écran de connexion) — un jeton mort ne doit
jamais laisser l'utilisateur bloqué sur un message d'erreur en poche. Un
403 reste un état VISIBLE distinct (« Accès refusé », sans bouton
Réessayer), jamais de déconnexion automatique (la session reste valide,
seul le droit manque).

**`ApiClientConfig.onUnauthorized`** — nouveau callback optionnel ajouté à
`request()` dans `apps/{home,build,web}/src/api/client.ts` (PAS
`control-pwa` : ses seules erreurs réseau utilisateur-visibles sont déjà
couvertes — vagues 1/3 — et sa synchro de missions est auto-cicatrisante,
sans état UI qui en dépende, voir vague 1). Appelé de façon SYNCHRONE dès
qu'un `response.status === 401` est détecté, AVANT même la construction de
l'`ApiError` — un 401 sur N'IMPORTE QUEL appel (pas seulement ceux passant
par `useApiResource`) déclenche la déconnexion. `login()` (formulaire de
connexion, ticket 020) ne passe jamais par `request()` : un 401
d'identifiants invalides n'est JAMAIS confondu avec une session morte,
déjà traité distinctement.

**`forceLogout()`, dupliqué par app** (`auth/forceLogout.ts`, même
discipline que `createApiClient`) — deux variantes selon que l'app héberge
son propre écran de connexion : `apps/{home,build}` n'en ont AUCUN (ticket
020 : seule `apps/web` en a un) — redirige vers l'origine d'`apps/web`
(`VITE_WEB_URL`) après avoir effacé le jeton ; `apps/web` recharge son
PROPRE origine (`App.tsx::App` lit `storedAccessToken` UNE SEULE FOIS à
l'initialisation, jamais réactif — seul un vrai rechargement de document
fait réapparaître l'écran de connexion une fois le jeton effacé).

**`isForbiddenError`/`ApiErrorBanner`, nouveaux exports partagés du design
system** — chaque app a sa PROPRE classe `ApiError` (même discipline que
`createApiClient`, jamais partagée) : `isForbiddenError` est duck-typé sur
`status` plutôt qu'un `instanceof`, correct quelle que soit la classe
d'origine. `ApiErrorBanner` (wrapper fin autour d'`AlertBanner`, jamais une
redéfinition) centralise le SEUL branchement qui différait entre les ~19
sites de ce projet rendant `<AlertBanner title="..." onRetry=.../>` sur une
erreur générique : `error.status === 403` → « Accès refusé », sans retry ;
sinon → le message contextuel existant, inchangé.

**Trois états d'erreur locaux (pas `useApiResource`) étendus pour porter
l'erreur brute**, jusqu'ici absente de leur état (`{ status: 'error' }`
sans payload) : `BackofficeView`/recherche utilisateur, `DevisView`/
`useDebouncedSearch` (recherche lot/organisation), `AllLotsView`/export
CSV — les ~16 autres sites utilisaient déjà `useApiResource`, qui porte
`error: unknown` depuis son origine.

**19 sites balayés** (`apps/home` : `App.tsx` ×2, `OverviewView`,
`MyActionsView`, `EvidenceFeedView`, `PriorityTaskSummary` ; `apps/build` :
`App.tsx`, `ExceptionsView`, `AllLotsView` ×2 ; `apps/web` : `App.tsx`,
`PricingView` ×2, `LegalPaymentTiersView` ×2, `BackofficeView` ×2,
`DevisView` ×3, `CountryPackSelector`) — un seul remplacement mécanique par
site (`<AlertBanner .../>` → `<ApiErrorBanner error={...} .../>`), aucune
autre logique changée.

**Tests** : `isForbiddenError`/`ApiErrorBanner` (design-system, 13 tests) ;
`onUnauthorized` par app (client.ts, 7 tests — un 401 déclenche, un 401 de
`login()` ne déclenche jamais, aucun autre statut ne déclenche) ; 6 tests
UI ciblés (403 → « Accès refusé », jamais de bouton Réessayer) sur les
sites les plus représentatifs, y compris les 3 états locaux étendus.
**421 tests frontend** (5 packages : 64+75+71+54+157), zéro régression
(3 exécutions consécutives propres de la suite complète), `tsc --noEmit`
propre.

**Pas de vérification en navigateur réel, décision assumée** (même
rationale que les points précédents de cette vague) : provoquer un VRAI
401/403 en cours de session exige un état serveur réel (jeton expiré,
compte désactivé, rôle retiré) — les tests automatisés (`ApiError`/
`vi.fn().mockRejectedValue`) reproduisent ces scénarios de façon plus
déterministe qu'une manipulation manuelle.

## Stale data — OverviewView et liste back-office (ticket F-033, vague 4)

Deux cas concrets, PAS le point plus large « missions/`knownLatestEventId`
CONTROL PWA » (limite déjà documentée, ticket 010 passe 2 — reste hors
scope, dépend d'un mécanisme de rafraîchissement de l'état connu jamais
construit) :

**`OverviewView` (HOME)** — `useApiResource(() => api.getLotOverview(lotId),
[lotId])` ne charge qu'UNE FOIS par `lotId` : aucun sondage périodique
(aucun écran de ce type n'en a dans ce projet), aucune action visible pour
tirer des données fraîches. Un client resté sur cet écran pendant qu'un
événement réel survient côté serveur (nouvelle preuve, jalon franchi,
réserve ouverte) ne le saurait qu'en quittant l'écran puis en y revenant
(démontage/remontage du composant). Corrigé par un bouton « Actualiser »
visible en permanence (pas seulement sur erreur), réutilisant
`state.refetch` (`useApiResource`, ticket F-033 vague 3 — jusque-là utilisé
UNIQUEMENT sur l'état d'erreur). Action MANUELLE, jamais un sondage
automatique en arrière-plan — cohérent avec le reste du projet, et honnête
: rien ne garantit qu'une donnée affichée soit RÉELLEMENT périmée à un
instant donné, seulement que l'utilisateur peut désormais vérifier
explicitement plutôt que de ne jamais savoir.

**Liste de résultats back-office, après désactivation d'un compte qui y
figure** — bug concret, pas une simple absence de sondage :
`BackofficeView::searchState.results` (peuplé UNE FOIS par
`api.searchUsers(query)`) et `UserDetailPanel::state` (son propre
`useApiResource`, ticket 011/021) sont deux états React totalement
INDÉPENDANTS. Désactiver un compte depuis le panneau de détail rafraîchit
CE panneau (déjà correct depuis le ticket 021 — relit `getUserDetail` via
`reloadKey`), mais jamais la LISTE derrière lui : l'entrée concernée
continuait d'afficher un compte actif (aucun suffixe « (compte
désactivé) ») jusqu'à ce que l'admin relance une recherche manuelle.

**Jamais une mise à jour optimiste locale** (patcher `is_active` sur
l'entrée concernée dans `searchState.results`) — même doctrine que
`UserDetailPanel` lui-même (« aucun calcul frontend, relit l'état réel
depuis le backend », ticket 021) : `UserDetailPanel` reçoit désormais un
callback `onDeactivated`, appelé juste après une désactivation réussie, qui
relance la RECHERCHE RÉELLE déjà affichée (`api.searchUsers`), jamais un
patch local.

**Piège de conception évité, trouvé en écrivant l'implémentation** : la
query qui a PRODUIT les résultats actuellement affichés
(`lastSearchedQueryRef`) est désormais distincte de `query` (l'état de
l'input, live) — un admin peut modifier le champ de recherche SANS
soumettre pendant qu'un profil reste ouvert ; rafraîchir avec la query LIVE
aurait silencieusement remplacé la liste affichée par des résultats pour un
texte différent de celui réellement recherché. `refreshCurrentSearch()`
(utilisée à la fois par le retry sur erreur ET par `onDeactivated`) relance
toujours `lastSearchedQueryRef.current`, jamais `query`.

**Second piège, trouvé en écrivant le test** : la première version faisait
encore `setSelectedUserId(null)` à l'intérieur de `runSearch` (hérité du
comportement existant, pensé pour une NOUVELLE recherche soumise par
l'admin) — un rafraîchissement après désactivation aurait donc fermé le
panneau de détail que l'admin venait juste de confirmer avoir désactivé,
perdant la confirmation visuelle de sa propre action. Corrigé en déplaçant
cette désélection dans `handleSearch` (le SEUL appelant qui doit
réellement fermer le panneau — une nouvelle recherche peut légitimement ne
plus contenir l'utilisateur sélectionné), jamais dans `runSearch`/
`refreshCurrentSearch`, qui rafraîchissent toujours la MÊME recherche déjà
affichée.

**2 nouveaux tests** (bouton « Actualiser », OverviewView ; liste
rafraîchie + panneau resté ouvert après désactivation, BackofficeView).
**423 tests frontend** (5 packages : 64+75+71+55+158), zéro régression
(2 exécutions consécutives propres de la suite complète), `tsc --noEmit`
propre.

**Pas de vérification en navigateur réel, décision assumée** : les deux
correctifs sont vérifiables de façon déterministe par les tests
automatisés (mocks de `getLotOverview`/`searchUsers`/`deactivateUser`
renvoyant des valeurs distinctes à deux appels successifs) — une
vérification manuelle n'aurait rien révélé de plus que ce que ces tests
prouvent déjà explicitement.

## Explicitement hors vague 4 (reste à prioriser)

- `resolveConflictByDiscarding` — même absence de `catch` que `persist()`
  avait, sévérité faible (pas d'état trompeur, l'inspecteur peut
  simplement recliquer).
- Missions/`knownLatestEventId` CONTROL PWA — limite déjà documentée,
  ticket 010 passe 2 (dépend d'un mécanisme de rafraîchissement de l'état
  connu jamais construit).

## Dépendances
Aucune — ticket purement frontend, `packages/design-system` +
`apps/{home,build,control-pwa,web}`, zéro changement backend.
