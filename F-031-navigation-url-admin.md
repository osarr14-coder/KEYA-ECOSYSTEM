# Ticket F-031 — Navigation par URL pour les écrans admin d'apps/web

## Statut
Livré. Branche `feature/frontend-round-2`. Les 4 écrans admin
(`BackofficeView`, `DevisView`, `PricingView`, `LegalPaymentTiersView`) ont
chacun leur propre URL (`/`, `/devis`, `/tarifs`, `/paliers-legaux`), le
bouton retour du navigateur fonctionne, et un lien direct vers un écran
précis survit à un rechargement de page.

## État des lieux — avant tout code

Mécanisme réel en place avant ce ticket (`App.tsx::AuthenticatedTabs`) : un
simple `useState<AuthenticatedTabId>('backoffice')`. `TabBar` (le composant
réellement cliqué par l'utilisateur, `packages/design-system`) est
purement callback-driven — `onChange(tabId)` ne fait qu'un `setActiveTab`,
sans toucher `window.location` ni l'historique du navigateur. Conséquences
concrètes avant ce ticket :
- le bouton retour ne faisait rien (aucune entrée d'historique n'était
  jamais créée par un changement d'onglet) ;
- un rechargement de page retombait toujours sur `'backoffice'` par
  défaut, quel que soit l'écran affiché avant ;
- aucun lien direct vers un écran précis n'était possible.

**Détail découvert en creusant** : `AppShell` (sidebar) rendait déjà de
vrais `<a href="/devis">` etc., à partir des valeurs déclarées dans
`MODULES` (ticket 025) — mais c'étaient des ancres inertes : cliquer dessus
déclenchait une vraie navigation plein-écran vers un chemin que rien ne
parsait au chargement, donc l'app redémarrait et retombait sur
`backoffice` par défaut. Les chemins existaient déjà dans le code, ils
n'étaient simplement jamais lus par personne.

**Vérifié avant de proposer une approche** :
- aucune dépendance de routeur nulle part dans le monorepo (`grep` sur
  tous les `package.json`) ;
- le serveur de dev Vite sert déjà `index.html` en repli SPA pour toute
  route inconnue (comportement par défaut) — le transport pour le lien
  direct fonctionnait déjà, seul l'état React devait se resynchroniser au
  chargement ;
- le flux d'authentification cross-app (`receiveIncomingSession.ts`)
  transite par le FRAGMENT d'URL (`#access_token=...`) sur `apps/web`,
  toujours vers `${origin}/` (`buildRedirectUrl`, jamais un chemin
  d'onglet), et ne nettoie que `url.hash` via `replaceState` — aucune
  collision avec un routage par `pathname`.

## Approche proposée et validée par l'utilisateur avant implémentation

Pas de routeur (`react-router` ou équivalent) — explicitement écarté par
l'utilisateur : 4 onglets plats derrière une seule garde `admin_keyimmo`
ne justifient pas les concepts qu'un routeur apporterait (routes
imbriquées, loaders...), pour un besoin qui reste "chaque onglet a son
URL, back/forward marche, lien direct marche".

**Retenu** : un hook local à `apps/web`, zéro dépendance ajoutée —
`useUrlSyncedTab` (`src/navigation/useUrlSyncedTab.ts`), appuyé sur deux
fonctions pures testables sans DOM (`src/navigation/tabRouting.ts`) :
- `resolveTabFromPath(routes, pathname, fallbackId)` — chemin → onglet,
  repli sur `fallbackId` si aucune route ne correspond ;
- `pathForTab(routes, tabId)` — onglet → chemin, lève une exception
  explicite si l'onglet n'a pas de route déclarée (erreur de
  configuration, jamais un cas d'exécution à absorber).

Le hook lui-même : lit `window.location.pathname` une seule fois à
l'initialisation du state pour dériver l'onglet actif ; `history.pushState`
(jamais une navigation complète) au changement d'onglet ; un listener
`popstate` pour le bouton retour/avance.

## Bien distinguer `pushState` d'une navigation complète

Point central de la conception : la sidebar `AppShell` déclenche déjà, elle,
une vraie navigation plein-page (ses `<a href>` ne sont pas interceptés —
composant partagé avec HOME/BUILD, hors périmètre de ce ticket, voir
ci-dessous). Le hook `useUrlSyncedTab`, lui, n'utilise QUE
`pushState`/`replaceState` : une navigation complète redémarrerait
`main.tsx` depuis zéro, perdant le profil `/me` déjà chargé
(`AuthenticatedApp`) pour un simple changement d'onglet — inacceptable pour
le mécanisme réellement utilisé au quotidien (`TabBar`).

## Périmètre délibérément restreint — `AppShell` non touché

`AppShell` (`packages/design-system`) est un composant PARTAGÉ avec HOME et
BUILD (ticket 007/023) — son API n'a pas été modifiée pour ce ticket. Ses
ancres de sidebar restent des navigations plein-page classiques (elles
pointent déjà, depuis le ticket 025, vers les bons chemins — `MODULES[].href`)
: cliquer dessus fonctionne désormais CORRECTEMENT (grâce au hook qui lit le
pathname au montage), juste sans la fluidité d'une navigation SPA. Interceptor
ces clics aurait exigé de faire connaître à `AppShell` un concept de routage
qu'il n'a pas — et que HOME/BUILD n'ont pas demandé. `TabBar`, en
revanche, EST le mécanisme réellement utilisé au quotidien pour changer
d'onglet dans `apps/web` — c'est lui qui est câblé au hook.

## Anti-duplication au passage

`MODULES` (sidebar `AppShell`) et `TABS` (`TabBar`) étaient deux tableaux
id/label maintenus séparément à la main depuis le ticket F-030 (même
id/label recopiés deux fois, jamais le chemin côté `TABS`, qui ne
connaissait pas encore l'URL avant ce ticket). Remplacés par une source
unique, `TAB_DEFINITIONS` (`App.tsx`), dont `MODULES`/`TABS`/`TAB_ROUTES`
(nouveau, pour `useUrlSyncedTab`) sont tous les trois dérivés — même
discipline anti-duplication qu'ailleurs dans ce projet (ex.
`CountryPackSelector`/`formatDrfFieldErrors`, tickets F-028/F-030).

## Ce qui a été construit
- `apps/web/src/navigation/tabRouting.ts` (+ `tabRouting.test.ts`, 5
  tests) : fonctions pures `resolveTabFromPath`/`pathForTab`.
- `apps/web/src/navigation/useUrlSyncedTab.ts` (+
  `useUrlSyncedTab.test.tsx`, 6 tests) : le hook lui-même — lecture au
  montage (avec correction d'URL pour un chemin inconnu), `pushState` au
  changement d'onglet (jamais dupliqué si l'onglet cliqué est déjà actif),
  listener `popstate`.
- `apps/web/src/App.tsx` : `TAB_DEFINITIONS` unique, `AuthenticatedTabs`
  utilise désormais `useUrlSyncedTab(TAB_ROUTES, 'backoffice')` au lieu
  d'un `useState` nu.
- `apps/web/src/App.test.tsx` : 4 nouveaux tests d'intégration (chargement
  direct sur `/tarifs`, changement d'onglet met à jour l'URL, bouton
  retour restaure l'onglet précédent, chemin inconnu retombe sur
  Back-office et corrige l'URL).

## Piège de test rencontré — `window.history.back()` sous jsdom
Une première version du test « bouton retour » utilisait
`window.history.back()` puis attendait un `popstate` en tâche différée
(`setTimeout(0)`) — le traitement des entrées `pushState` (sans navigation
réelle) par `back()`/`forward()` s'est révélé incomplet/peu fiable dans
cette version de jsdom (`popstate` jamais observé par le test, alors que
`history.length` progressait correctement à chaque `pushState`, testé
séparément). Corrigé en testant directement le CONTRAT que le hook
documente — écouter `popstate` — plutôt que l'implémentation interne de
jsdom : le test simule ce qu'un vrai bouton retour produit
(`history.replaceState` + `dispatchEvent(new PopStateEvent('popstate'))`)
au lieu de `history.back()`.

## Vérification
- **15 nouveaux tests** (5 `tabRouting.test.ts` + 6
  `useUrlSyncedTab.test.tsx` + 4 `App.test.tsx`). **308 tests frontend** sur
  les 5 packages (44+37+54+40+133), zéro régression, `tsc --noEmit` propre.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte
  `admin_keyimmo` réel) :
  - clic sur "Tarifs" (`TabBar`) → URL passe à `/tarifs` sans rechargement
    (aucun flash de chargement, profil `/me` non re-fetché) ;
  - rechargement direct de la page sur `/tarifs` → écran Tarifs affiché
    immédiatement (token déjà en session), `aria-current="page"` posé à la
    fois sur le bouton `TabBar` et l'ancre sidebar correspondants ;
  - navigation Tarifs → Paliers légaux puis bouton retour RÉEL du
    navigateur → retour correct sur Tarifs (sélecteur de pays réaffiché,
    pas un écran vide) ;
  - chemin inconnu (`/ecran-inexistant`) → repli sur Back-office, URL
    corrigée silencieusement vers `/` ;
  - lien direct vers `/devis` → écran Devis affiché directement, breadcrumb
    correct, aucune erreur console applicative (recherche de lot
    fonctionnelle).

## Explicitement hors scope
- Configuration de repli SPA pour un hébergement de production (nginx
  `try_files`, Netlify `_redirects`...) — ce projet n'a aucune
  configuration de déploiement à ce jour (voir CLAUDE.md, ticket
  021 : "dette explicite à lever avant tout pilote réel"). Le serveur de
  dev Vite fait déjà ce repli nativement, suffisant pour ce ticket.
- Interception des clics sur la sidebar `AppShell` pour éviter une
  navigation plein-page — composant partagé avec HOME/BUILD, hors
  périmètre.
- Tout routage pour HOME/BUILD/CONTROL PWA — ticket strictement scopé à
  `apps/web`.

## Dépendances
Aucune — ticket purement frontend, `apps/web` uniquement, zéro changement
backend.
