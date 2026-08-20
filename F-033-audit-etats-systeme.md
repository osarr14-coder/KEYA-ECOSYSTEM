# Ticket F-033 — Audit des états système (doctrine 17.5 V3.0)

## Statut
En cours, par vagues. **Vague 1 livrée** (branche `feature/frontend-round-2`) :
deux défauts de robustesse trouvés et corrigés dans CONTROL PWA
(`MissionsListView`/`InspectionFormView`), tests écrits avant correctif.
Vagues 2/3/4 (offline hors CONTROL PWA, permission denied, retry sur les
erreurs génériques, `sync failed` par photo, stale data) restent à
prioriser avec l'utilisateur — non commencées.

## Étape 1 — audit exhaustif (aucune correction), livré et discuté avec l'utilisateur

Tous les écrans admin d'`apps/web` (BackofficeView, DevisView, PricingView,
LegalPaymentTiersView) et les 3 apps (HOME, BUILD, CONTROL PWA) ont été lus
intégralement — pas d'extrapolation depuis CLAUDE.md seul. Tableau complet
(écran × état pertinent × géré/manquant/à vérifier) livré en conversation.

**Constats transversaux les plus significatifs** (au-delà de la grille
écran par écran) :
1. `offline` n'a de détection réelle que dans CONTROL PWA
   (`App.tsx::useOnlineStatus`) — les 6 autres écrans/apps n'ont aucune
   détection réseau, une coupure y ressemble à une erreur serveur
   générique.
2. `permission denied` n'a un vrai état dédié qu'à un seul endroit
   (`apps/web::App.tsx`, gate `admin_keyimmo`) — partout ailleurs, un
   401/403 en cours de session tombe dans le même message générique
   qu'une panne serveur (`grep` confirmé : `status === 401` n'apparaît
   nulle part ailleurs que le formulaire de connexion).
3. Aucun bouton « Réessayer » nulle part sur les ~25 `AlertBanner`
   d'erreur du projet.
4. **Deux bugs de robustesse réels trouvés en lisant le code** (pas de
   simples manques de style) — objet de la vague 1, voir ci-dessous.
5. `sync failed` (photos) tracké en données (`LocalPhoto.mediaSyncStatus
   === 'failed'`) mais jamais affiché nulle part dans `PhotoThumbnail`.

## Vague 1 — vérification de l'étendue avant correction (demande explicite)

Avant de corriger le point 4, l'utilisateur a demandé de vérifier si le
même défaut (échec IndexedDB jamais catché) existait ailleurs que
`MissionsListView`, pour ne pas en laisser un autre en place.

**Méthode** : lecture intégrale de `db/repository.ts` (9 fonctions
exportées) et `grep` de tous leurs appelants dans `apps/control-pwa/src`
(hors tests).

**Constat** : chaque fonction de `repository.ts` utilise `try { ... }
finally { db.close(); }` — **jamais** de `catch`, ce qui est en fait le
comportement CORRECT pour une couche de données (elle doit propager les
erreurs, pas les avaler). Le vrai défaut est côté appelants — recensement
exhaustif :

| Appelant | Défaut trouvé | Sévérité | Décision |
|---|---|---|---|
| `MissionsListView` (effet de montage) | `getCachedMissions()` jamais catché → rejection non gérée, aucun état d'erreur | Élevée — écran figé sur un « vide » trompeur | **Corrigé (vague 1)** |
| `MissionsListView` (statuts par mission) | `Promise.all` sur `getDraftForMission` — un échec vide le statut de TOUTES les missions | Élevée | **Corrigé (vague 1)** |
| `InspectionFormView` (effet de montage) | Même défaut exact (IIFE sans `catch`) → `loading` bloqué à `true` indéfiniment | Élevée — écran figé sur un spinner infini | **Corrigé (vague 1)** — même forme, même correctif trivial |
| `InspectionFormView::persist()` | Chaîne de promesses sans `catch` — la mise à jour optimiste (`setDraft`) a déjà eu lieu de façon SYNCHRONE avant l'écriture : un échec silencieux ferait croire à l'utilisateur que sa saisie est enregistrée alors qu'elle ne l'est pas | Élevée mais correctif DIFFÉRENT (nécessite une nouvelle UI « échec d'enregistrement local », pas juste un `catch` qui logge) | **Hors vague 1** — noté explicitement comme suite à prévoir, jamais oublié silencieusement |
| `InspectionFormView::resolveConflictByDiscarding` | Même absence de `catch` sur `deleteDraft` | Faible — aucun état trompeur, l'écran de conflit reste affiché tel quel si ça échoue, l'inspecteur peut réessayer | **Hors vague 1** — décision consciente, pas un oubli |
| `syncEngine.ts::runSyncCycle` (`getAllDrafts`) | Pas de `catch` autour de l'appel | Nulle — **auto-cicatrisant** (retenté toutes les 15s / à la reconnexion), aucun état UI n'en dépend directement | **Aucune correction nécessaire** — vérifié, pas un défaut réel |
| `syncEngine.ts::refreshMissions` | — | — | Déjà correct : `try/catch` existant et documenté (échec silencieux volontaire, retenté au cycle suivant) |

## Correctifs (vague 1)

**`MissionsListView.tsx`** — nouvel état `LoadState` (`'loading' |
'error' | 'ready'`) remplaçant le simple `missions.length === 0` comme
seul signal : `getCachedMissions()` est désormais dans un `try/catch`
explicite (`AlertBanner` sur échec, jamais un « Aucune mission » trompeur).
Le `Promise.all` sur les statuts de synchro par mission devient
`Promise.allSettled` : une mission dont la lecture échoue n'affiche
simplement aucun statut (comportement déjà accepté pour une mission
jamais entamée), les autres gardent le leur.

**`InspectionFormView.tsx`** — nouvel état `loadError` à côté de `loading` :
l'effet de montage capture désormais l'échec de
`Promise.all([getDraftForMission, getCachedMission])` dans un `try/catch`,
affiche `AlertBanner` plutôt que de laisser `loading` bloqué à `true` pour
toujours.

## Tests écrits AVANT correction (même discipline que le ticket 015)

- `MissionsListView.test.tsx` (+3 tests) : état de chargement explicite ;
  `getCachedMissions()` en échec → `AlertBanner`, jamais un vide
  silencieux ; **le test central demandé explicitement** — deux missions,
  `getDraftForMission` échoue pour l'une, la mission dont la lecture
  RÉUSSIT garde son vrai statut affiché (`Promise.allSettled`). Les trois
  tests ont été lancés et confirmés ROUGES contre le code non corrigé
  AVANT toute modification de `MissionsListView.tsx` (deux « Unhandled
  Rejection » observées, preuve directe du bug) — capture figée dans
  l'historique de la session, pas juste affirmée.
- `InspectionFormView.test.tsx` (+2 tests) : échec de
  `getDraftForMission`/`getCachedMission` au montage → `AlertBanner`,
  jamais un blocage indéfini sur « Chargement… ». Rouge confirmé avant
  correctif (même mécanisme d'« Unhandled Rejection » observé).

## Vérification

**59 tests `apps/control-pwa`** (was 54, +5), **338 tests frontend** au
total (5 packages : 44+62+59+40+133), zéro régression, `tsc --noEmit`
propre.

**Pas de vérification en navigateur réel pour cette vague** — décision
assumée, pas un oubli : les deux correctifs sont purement additifs (aucun
chemin nominal modifié, seulement de nouvelles branches d'erreur
atteignables uniquement par un VRAI échec IndexedDB). Provoquer un tel
échec de façon authentique dans un navigateur réel serait lui-même
artificiel — les tests automatisés, qui interceptent précisément
`getCachedMissions`/`getDraftForMission`/`getCachedMission` via
`vi.spyOn`, reproduisent le scénario de façon plus déterministe qu'une
manipulation manuelle. Le chemin nominal (missions/inspection réelles)
reste couvert par les tests déjà existants de ces deux fichiers,
inchangés et toujours verts.

## Explicitement hors vague 1 (vagues 2/3/4, non commencées)

- `InspectionFormView::persist()` — échec d'écriture silencieux malgré
  mise à jour optimiste déjà affichée (nécessite une nouvelle UI, pas
  juste un `catch`).
- `resolveConflictByDiscarding` — même absence de `catch`, sévérité faible.
- Détection `offline` hors CONTROL PWA (HOME/BUILD/`apps/web`).
- États `permission denied` dédiés au-delà du gate `admin_keyimmo`.
- Bouton « Réessayer » sur les erreurs génériques.
- `sync failed` par photo (`mediaSyncStatus === 'failed'`) jamais affiché
  dans `PhotoThumbnail`.
- Incohérence `<p role="alert">` vs `AlertBanner` (HOME/BUILD `App.tsx`).
- Stale data (`OverviewView`, missions/`knownLatestEventId` CONTROL PWA).

## Dépendances
Aucune — ticket purement frontend, `apps/control-pwa` uniquement pour
cette vague, zéro changement backend.
