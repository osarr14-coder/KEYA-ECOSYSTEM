# Ticket F-040 — Navigation inter-apps réelle (sidebar `AppShell`)

## Statut

**Implémenté, testé, documenté.** 5 tests dédiés (3 dans `appOrigins.test.ts`
côté design-system, 2 dans `apps/build/src/App.test.tsx`, 2 dans
`apps/home/src/App.test.tsx`), suites `design-system` (97), `web` (180),
`build` (17), `home` (19), `control-pwa` (73) toutes vertes, `tsc --noEmit`
propre sur les 4 apps + design-system.

## Origine

Constaté en vérification manuelle exhaustive (visite des menus des 4
profils, tous rôles), pas en lisant le code d'abord : cliquer « FINANCE »
(rôle sponsor, HOME) et « Accueil » (rôle constructeur, BUILD) change bien
l'URL affichée mais **le contenu rendu reste strictement identique**.

Cause racine : chaque `AppModule.href` (composant `AppShell`, ticket 007)
est un `<a href="/chemin">` relatif, mais BUILD/HOME/CONTROL sont des SPA
**sans routeur** — un seul composant `<App>` se rend quel que soit le
chemin (`activeModuleId` est même codé en dur dans BUILD/HOME). Seule
apps/web échappe au problème : ses modules sidebar sont synchronisés à un
vrai état applicatif via `useUrlSyncedTab` (ticket F-031), pas de simples
liens inertes.

Deux bugs distincts trouvés, tous deux dans la fonction gate-role
`requiredRoles`/`href` :

1. **"Accueil" (apps/build)** — chemin relatif `/` sur l'origine de BUILD
   elle-même : lien mort, jamais un retour vers HOME.
2. **"BUILD" (apps/home)** — un seul module `requiredRoles: ['constructeur',
   'inspecteur']` pointait vers `/build` pour LES DEUX rôles, alors qu'un
   inspecteur doit atterrir sur CONTROL (mapping `resolveRedirectApp`,
   tickets 020/021) : même en ignorant le chemin relatif mort, le mapping
   rôle → app était lui-même faux pour l'inspecteur.

**Explicitement PAS touché** (voir investigation avant implémentation,
section Décisions) : la visibilité de FINANCE/NOTARY selon le rôle actif
est un comportement **testé et intentionnel** (3 tests dans
`apps/build/src/App.test.tsx` vérifient explicitement que FINANCE
apparaît/disparaît selon le rôle de l'organisation active) — aucune app
FINANCE/NOTARY dédiée n'existe encore (limitation MVP déjà documentée dans
`redirectTarget.ts`), mais le retirer aurait cassé une intention de
conception établie, pas seulement des tests.

## Décisions de conception

**A. Réutilisation du mécanisme de transfert de session existant**
(`apps/web/src/auth/redirectTarget.ts`, tickets 020/021) : jeton en
fragment d'URL (`#access_token=...&refresh_token=...`), lu une seule fois
par `receiveIncomingSession()` dans chaque app cible — déjà utilisé à la
connexion, jamais spécifique au login en soi. Les liens sidebar
inter-apps construisent maintenant une vraie URL cross-origine avec ce
même mécanisme, plutôt qu'un chemin relatif.

**B. `resolveAppOrigins`/`buildCrossAppUrl` promus dans `@keya/design-system`**
(nouveau dossier `src/navigation/`, mémé schéma que `hooks/useOnlineStatus`
ou `errors/isForbiddenError`) — apps/build et apps/home en ont besoin
elles aussi, jamais une seconde copie. `apps/web/src/auth/redirectTarget.ts`
ré-exporte `resolveAppOrigins` et fait de `buildRedirectUrl` un mince
wrapper de `buildCrossAppUrl` (même nom conservé, aucun appelant existant
cassé). `resolveRedirectApp` (mapping rôle → app, spécifique à la
connexion) reste dans apps/web, pas déplacé.

**C. Module "BUILD" (apps/home) scindé en deux : "BUILD" (`constructeur`
uniquement) et "CONTROL" (`inspecteur` uniquement)** — corrige le mapping
faux en même temps que le lien mort ; chacun avec sa propre URL
cross-origine.

**D. Tokens lus en LIVE à chaque rendu, jamais mémoïsés** — `buildModules()`
relit `localStorage.getItem('keya_access_token'/'keya_refresh_token')` à
chaque appel plutôt que de figer les hrefs au montage : un rendu long-vécu
(l'utilisateur reste sur la page un moment) ne doit jamais embarquer un
jeton périmé dans un lien cliqué plus tard. Retombe sur l'origine nue
(sans fragment) si aucune session n'est encore en `localStorage`.

**E. FINANCE/NOTARY (apps/home) et BUILD/FINANCE/NOTARY (apps/build,
propre module self-référençant excepté) : NON touchés** — voir Origine.
Le rôle sponsor reste sans destination fonctionnelle réelle (FINANCE
n'existe pas) : limitation MVP déjà assumée, explicitement hors scope de
ce ticket (voir aussi Explicitement hors scope).

**F. apps/control-pwa : hors scope** — aucun `AppShell`/sidebar
(conception volontaire, écran mobile 2 vues, ticket 010), donc aucun lien
à corriger.

## Entités touchées

- `packages/design-system/src/navigation/appOrigins.ts` (nouveau) —
  `AppOrigins`, `resolveAppOrigins`, `buildCrossAppUrl` (extraits de
  `apps/web/src/auth/redirectTarget.ts`, logique identique).
- `packages/design-system/src/navigation/appOrigins.test.ts` (nouveau) —
  3 tests (défauts, construction d'URL, encodage de caractères spéciaux).
- `packages/design-system/src/vite-env.d.ts` (nouveau) — référence
  `vite/client` nécessaire pour typer `import.meta.env.VITE_*_URL`
  (absente jusqu'ici, design-system ne lisait aucune variable d'env).
- `packages/design-system/src/index.ts` — export de `resolveAppOrigins`,
  `buildCrossAppUrl`, `AppOrigins`.
- `apps/web/src/auth/redirectTarget.ts` — `resolveAppOrigins` ré-exportée
  depuis design-system ; `buildRedirectUrl` devient un wrapper de
  `buildCrossAppUrl`. Aucun changement de comportement, aucun test cassé.
- `apps/build/src/App.tsx` — `MODULES` (const statique) remplacé par
  `buildModules()` (fonction appelée au rendu) ; "Accueil" pointe vers une
  vraie URL cross-origine HOME.
- `apps/build/src/App.test.tsx` — 2 tests dédiés ("Accueil" avec session
  présente / absente).
- `apps/home/src/App.tsx` — idem, `MODULES` → `buildModules()` ; module
  "BUILD" scindé en "BUILD" (constructeur) / "CONTROL" (inspecteur), tous
  deux avec vraie URL cross-origine.
- `apps/home/src/App.test.tsx` — 2 tests dédiés (constructeur voit
  BUILD/jamais CONTROL avec le bon href, inspecteur voit CONTROL/jamais
  BUILD avec le bon href) ; libellé du test "aucun module professionnel"
  mis à jour (BUILD/CONTROL/FINANCE/NOTARY).

## Scope inclus

- Lien "Accueil" (apps/build) → vraie navigation cross-origine vers HOME
  avec transfert de session.
- Mapping "BUILD"/"CONTROL" (apps/home) corrigé selon le rôle actif, avec
  vraie navigation cross-origine.
- Promotion de `resolveAppOrigins`/`buildCrossAppUrl` dans
  `@keya/design-system`, sans duplication, sans régression côté apps/web.

## Explicitement hors scope

- **FINANCE/NOTARY** — comportement testé et intentionnel, non touché
  (voir Origine/Décision E). Aucune app cible n'existe : un futur ticket
  devra soit déployer ces apps, soit décider explicitement de masquer ces
  modules — décision produit, pas une correction de bug de navigation.
- **apps/control-pwa** — aucun `AppShell`, hors scope par construction.
- **Le "BUILD" self-référençant dans apps/build** (module `id: 'build'`,
  `href: '/build'`, actif) — lien vers soi-même, sans effet visible
  (rechargement complet de la même vue), pas un bug de destination, non
  touché.

## Critères d'acceptation

- [x] "Accueil" (apps/build) construit une URL cross-origine réelle vers
      HOME, avec fragment `access_token`/`refresh_token` quand une session
      existe en `localStorage`.
      (`test('construit un lien avec transfert de session...')`)
- [x] "Accueil" retombe sur l'origine HOME nue (sans fragment) si aucune
      session n'est encore en `localStorage`.
      (`test('retombe sur l'origine HOME nue...')`)
- [x] Un constructeur voit "BUILD" (URL cross-origine vers apps/build),
      jamais "CONTROL".
      (`test('un constructeur voit BUILD ... mais jamais CONTROL')`)
- [x] Un inspecteur voit "CONTROL" (URL cross-origine vers
      apps/control-pwa), jamais "BUILD".
      (`test('un inspecteur voit CONTROL ... mais jamais BUILD')`)
- [x] FINANCE/NOTARY inchangés : toujours masqués pour un rôle client,
      toujours révélés au bon rôle (tests existants, non modifiés,
      passent sans adaptation).
- [x] Aucune duplication de `resolveAppOrigins`/`buildCrossAppUrl` entre
      apps/web et design-system — apps/web délègue.
- [x] `tsc --noEmit` propre sur les 4 apps + design-system.
- [x] Toutes les suites existantes (design-system 97, web 180, build 17,
      home 19, control-pwa 73) passent sans modification, sauf les 2
      libellés de test mis à jour pour refléter "CONTROL" (nouveau
      module) dans la liste des modules professionnels absents pour un
      client.

## Notes d'implémentation

**Investigation AVANT implémentation** — la proposition initiale prévoyait
de masquer FINANCE/NOTARY (aucune app cible). En lisant
`apps/build/src/App.test.tsx` avant d'écrire le code, 3 tests existants
se sont révélés vérifier explicitement l'apparition de FINANCE pour un
rôle sponsor (bascule d'organisation, App Switcher ticket 019) : la
visibilité de ces modules est une intention de conception délibérée
("le module existe, l'app dédiée viendra plus tard"), pas un oubli.
Signalé et validé avant de continuer, plutôt que de casser silencieusement
un comportement testé.

**`import.meta.env.VITE_*_URL` dans design-system** — jusqu'ici design-system
ne lisait aucune variable d'environnement (`vite-env.d.ts` absent). Ajouté
pour typer correctement `resolveAppOrigins`, résolu sans dépendance
supplémentaire (`vite` déjà hissé à la racine du monorepo via les
workspaces npm).

5 tests dédiés, suites design-system (97)/web (180)/build (17)/home
(19)/control-pwa (73) toutes vertes, `tsc --noEmit` propre partout.
