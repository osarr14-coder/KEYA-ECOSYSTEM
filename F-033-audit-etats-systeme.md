# Ticket F-033 — Audit des états système (doctrine 17.5 V3.0)

## Statut
En cours, par vagues. **Vagues 1, 2 et 3 livrées** (branche
`feature/frontend-round-2`). Vague 4 (permission denied dédiée, `sync
failed` par photo CONTROL PWA, incohérences résiduelles) reste à prioriser
avec l'utilisateur — non commencée.

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

## Explicitement hors vague 1/2/3 (vague 4, non commencée)

- États `permission denied` dédiés au-delà du gate `admin_keyimmo`
  d'`apps/web`.
- `sync failed` par photo (`LocalPhoto.mediaSyncStatus === 'failed'`)
  jamais affiché dans `PhotoThumbnail`.
- `InspectionFormView::persist()` — échec d'écriture silencieux malgré
  mise à jour optimiste déjà affichée.
- `resolveConflictByDiscarding` — même absence de `catch`, sévérité
  faible.
- Stale data (`OverviewView`, missions/`knownLatestEventId` CONTROL PWA).

## Dépendances
Aucune — ticket purement frontend, `packages/design-system` +
`apps/{home,build,control-pwa,web}`, zéro changement backend.
