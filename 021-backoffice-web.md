# Ticket 021 — Interface back-office (apps/web)

## Statut
Livré. Branche `feature/frontend-round-2`. Construit une interface pour les trois
endpoints livrés côté backend au ticket 011 (recherche utilisateur, consultation
organisation/rôle, désactivation de compte) — jusqu'ici utilisables uniquement via l'API
navigable Django, sans aucun écran.

## Objectif
Écran réservé au rôle `admin_keyimmo` dans `apps/web` : recherche d'un utilisateur,
consultation de son organisation/rôle, désactivation de compte avec confirmation
explicite. Réutilise `AppShell` (variante dense) et les composants existants du design
system — aucun composant recréé en parallèle.

## Contexte et décision d'architecture validée avant implémentation
- **`apps/web` était jusqu'ici SEULEMENT un écran de connexion (ticket 020)** :
  formulaire → `POST /api/auth/login/` → `GET /api/me/` → redirection IMMÉDIATE vers
  HOME/BUILD/CONTROL selon le rôle réel, sans jamais rester sur place. Aucun
  `receiveIncomingSession`, aucune session persistée, aucun `ApiClientContext`
  authentifié n'y existait — tout ça n'existait que dans HOME/BUILD/CONTROL PWA.
- **Décision validée avec l'utilisateur avant d'écrire du code** : plutôt que de garder
  `apps/web` login-only et bricoler un second écran conditionnel avant la redirection,
  `admin_keyimmo` gagne sa propre branche dans `resolveRedirectApp` → `'web'`
  (auto-référence) — apps/web devient un point d'arrivée comme les 3 autres apps (son
  propre `receiveIncomingSession`, `ApiClientContext`, écran post-connexion). Cohérent
  avec le pattern déjà établi plutôt qu'un mécanisme parallèle. Voir
  `020-ecran-connexion.md`, section « Évolution ticket 021 », pour la note explicite
  côté ticket d'origine — ce changement de mapping n'est pas un oubli du ticket 020, cette
  destination n'existait simplement pas encore à l'époque.
- **Isolation git découverte en démarrant ce ticket** : le dossier de travail
  (`C:\Projets claude\KEYA ECOSYSTEM`) est partagé avec une autre session travaillant en
  parallèle sur `master` (documentation, ADR-002, Gate 3) — chaque `git checkout` de l'une
  bascule le HEAD de l'autre (confirmé via `git reflog`, aucun `git worktree list` séparé
  au départ). Résolu en créant un worktree dédié
  (`C:\Projets claude\KEYA-ECOSYSTEM-frontend-round-2`, branche `feature/frontend-round-2`)
  avant toute écriture de code — tout ce ticket a été développé dans ce worktree.

## Entités touchées
- `apps/web/src/auth/redirectTarget.ts` — `AppOrigins.web` (nouvelle origine),
  `resolveRedirectApp` gagne la branche `admin_keyimmo → 'web'`, doc mise à jour
  explicitement (voir ci-dessus) ; `isSameOriginRedirect` (nouveau, voir bug réel trouvé
  en vérification navigateur, section « Vérification » ci-dessous).
- `apps/web/src/auth/receiveIncomingSession.ts` (nouveau) — même mécanisme exact que
  `apps/{home,build,control-pwa}` (ticket 020), dupliqué plutôt que partagé (même
  discipline déjà assumée pour `createApiClient` entre apps).
- `apps/web/src/auth/adminAccess.ts` (nouveau) — `deriveAllRoleCodes`/
  `hasAdminKeyimmoAccess`, dérivation de rôle TRANSVERSE (toutes les memberships, pas
  seulement la première) — voir « Décisions de conception » ci-dessous.
- `apps/web/src/api/client.ts` — `getAccessToken` devient un paramètre optionnel (défaut
  `() => null`, rétrocompatible avec les tests du ticket 020) ; nouvelles méthodes
  `searchUsers`/`getUserDetail`/`deactivateUser`. `login`/`getMe` inchangés côté
  signature.
- `apps/web/src/api/types.ts` — `BackofficeUserSummary`/`BackofficeMembershipSummary`/
  `BackofficeUserDetail`, miroirs des serializers `apps.backoffice.serializers` (ticket
  011).
- `apps/web/src/api/useApiResource.ts` (nouveau) — même utilitaire que
  `apps/{home,build}`, dupliqué (aucun partage inter-apps dans ce monorepo).
- `apps/web/src/views/BackofficeView.tsx` (nouveau) — recherche, panneau de détail,
  désactivation à double confirmation.
- `apps/web/src/App.tsx` — restructuré : `App` bascule entre `LoginView` (formulaire,
  comportement du ticket 020 strictement inchangé) et `AuthenticatedApp` (back-office)
  selon la présence d'un token en `localStorage` ; `defaultRedirect` force un
  rechargement explicite pour une redirection vers la même origine (bug réel trouvé en
  vérification navigateur, voir « Vérification » ci-dessous).
- `apps/web/src/main.tsx` — appelle `receiveIncomingSession()`, fournit `getAccessToken`
  au client API.
- Aucun fichier sous `backend/apps/` touché — lecture seule du contrat existant
  (`apps/backoffice/{urls,views,serializers,permissions}.py`, ticket 011).

## Décisions de conception
1. **`hasAdminKeyimmoAccess` vérifie TOUTES les memberships, pas seulement la première**
   — contrairement à `resolveRedirectApp`/l'App Switcher (ticket 019), qui dérivent le
   rôle de la PREMIÈRE membership ou de l'organisation ACTIVE. `admin_keyimmo` est une
   capacité TRANSVERSE (même raisonnement que `IsAdminKeyimmo` côté backend,
   `apps/backoffice/permissions.py`, ticket 011, qui vérifie le rôle dans N'IMPORTE
   LAQUELLE des organisations). Utiliser la première membership seule aurait refusé
   l'accès à tort à un admin légitime dont la première organisation n'est pas KEYIMMO.
2. **Gate applicatif EN PLUS de la garde backend, jamais à sa place** : `AuthenticatedApp`
   vérifie `hasAdminKeyimmoAccess` avant tout rendu du back-office (jamais un
   clignotement, même partiel) — le module `Back-office` de `AppShell` porte aussi
   `requiredRoles: ['admin_keyimmo']` (défense en profondeur, même discipline que RLS +
   filtre applicatif ailleurs dans ce projet).
3. **Double confirmation pour la désactivation, jamais `window.confirm()`** : un premier
   clic sur « Désactiver ce compte » n'exécute rien — il affiche un `AlertBanner` +
   un second bouton dédié « Confirmer la désactivation ». Seul CE second clic appelle
   `deactivateUser`. Un bouton « Annuler » ferme la confirmation sans effet. Après succès,
   l'UI relit l'état RÉEL depuis le backend (`getUserDetail`), jamais une mise à jour
   optimiste locale — même discipline « aucun calcul frontend » que le reste du projet.
4. **Aucun texte ne mentionne un `TrustEvent`, une réserve, une validation ou un statut
   de confiance** — l'action ne porte QUE sur `User.is_active`. Vérifié par un test qui
   scanne TOUS les boutons rendus contre une liste de formulations interdites (même
   pattern que `apps/build/src/views/ExceptionsView.test.tsx`, ticket 009, et la garde
   backend `TestBackofficeNeverExposesATrustEventShortcut`, ticket 011).

## Scope livré
1. **Écran réservé à `admin_keyimmo`** (`AuthenticatedApp` dans `App.tsx`) — accès
   refusé (`AlertBanner`) pour tout autre rôle, jamais un rendu partiel du back-office.
2. **Recherche d'utilisateur + organisation(s)/rôle(s)** (`BackofficeView.tsx`) —
   formulaire de recherche par email (`GET /api/backoffice/users/?q=...`), sélection d'un
   résultat, panneau de détail listant CHAQUE organisation et le rôle associé
   (`GET /api/backoffice/users/{id}/`).
3. **Désactivation avec confirmation explicite** — voir décision de conception n°3
   ci-dessus.
4. **Aucun raccourci TrustEvent suggéré** — voir décision de conception n°4 ci-dessus.
5. **`AppShell` (dense) et composants du design system réutilisés tels quels** —
   `AlertBanner` pour les erreurs et la confirmation, aucun nouveau composant ajouté au
   design system pour ce ticket.

## Vérification
- **62 tests frontend** dans `apps/web` (38 nouveaux/modifiés au-delà des 21 du ticket
  020) : mapping de rôle (`redirectTarget.test.ts`), dérivation transverse
  (`adminAccess.test.ts`), client HTTP back-office (`client.test.ts`), réception de
  session (`receiveIncomingSession.test.ts`), bascule login/back-office et accès refusé
  (`App.test.tsx`), recherche/détail/confirmation/désactivation/garde anti-TrustEvent
  (`BackofficeView.test.tsx`). Suite complète du monorepo frontend revérifiée après coup
  (design-system, home, build, control-pwa) : aucune régression, `tsc --noEmit` propre.

### Outillage `preview_start` — problème d'environnement, contournement trouvé
`preview_start` avec un `name` (lancement déclaratif du serveur de dev via
`.claude/launch.json`) échoue systématiquement dans cet environnement Windows :
`'C:\Program' n'est pas reconnu...` — un chemin résolu (`C:\Program Files\nodejs\...`)
arrive visiblement non quoté quelque part dans la chaîne de spawn de l'outil. **Cinq
contournements testés côté configuration, tous infructueux, erreur strictement
identique à chaque fois** : `npm` nu, chemin absolu quoté vers `npm.cmd`, wrapper
`cmd.exe /c` explicite, **chemin court 8.3 sans espace** (`C:\PROGRA~1\nodejs\npm.cmd`,
confirmé fonctionnel en direct via Bash), et un nom de configuration neuf (exclut un
souci de cache). `npm run dev --workspace=@keya/web` lancé directement en Bash
démarre, lui, sans erreur (`EXIT:0`) — la config/le code ne sont pas en cause. **Bug
d'environnement/outillage confirmé, pas un problème de ce ticket.**

**Contournement RÉEL trouvé et utilisé pour toute la suite de cette vérification** :
démarrer le serveur manuellement en arrière-plan (Bash `run_in_background`), puis
appeler `preview_start` avec `{url: "http://localhost:5176"}` au lieu de `{name: ...}`
— ouvre un vrai onglet Chrome pointé sur le serveur déjà démarré, sans passer par le
lancement déclaratif cassé. Fonctionne à l'identique pour le second serveur nécessaire
(Django). **Dette explicite à lever avant tout pilote réel** : ce contournement manuel
fonctionne mais n'est pas le flux `preview_start({name})` prévu par l'outillage — à
réinvestiguer si l'outil est mis à jour, ou si l'environnement change (ex. profil
utilisateur Windows sans espace dans le nom, ou Node installé hors `Program Files`).

### Vérification RÉELLE en navigateur, avec un vrai backend — pas un stub
Le contournement ci-dessus a permis de faire le VRAI aller-retour demandé, pas une
simulation : backend Django réel monté pour l'occasion (Postgres dédié
`docker-compose.yml` du projet, port 5433, migrations appliquées, deux comptes réels
créés — `admin-verif@example.com` en `admin_keyimmo` et `cible-verif@example.com` en
`constructeur` d'une organisation distincte), serveur `apps/web` réel sur le port 5176.
Parcours complet exécuté dans Chrome :
1. Connexion avec les vrais identifiants `admin-verif@example.com` → `POST
   /api/auth/login/` puis `GET /api/me/` réels (200, network réel confirmé via
   `read_network_requests`).
2. **Bug réel trouvé à cette étape, invisible aux tests unitaires** : après
   connexion, l'écran restait bloqué sur le formulaire malgré un token réel désormais
   présent dans l'URL (`window.location.href` le confirmait). Cause : une redirection
   `admin_keyimmo` vers apps/web ELLE-MÊME ne change que le FRAGMENT de l'URL (même
   origine, même chemin) — un changement de fragment seul ne recharge JAMAIS un
   document (comportement standard des navigateurs, identique à un lien d'ancre),
   donc `main.tsx` ne rejouait jamais `receiveIncomingSession()`. Les tests
   unitaires ne pouvaient pas le voir : ils injectent un `redirect` mocké (jamais la
   vraie navigation du navigateur) précisément pour rester déterministes — exactement
   le genre de défaut que seul un vrai aller-retour navigateur révèle. **Corrigé**
   (`apps/web/src/auth/redirectTarget.ts::isSameOriginRedirect` +
   `apps/web/src/App.tsx::defaultRedirect`) : un rechargement explicite
   (`window.location.reload()`) est désormais forcé quand la cible ne diffère de la
   page courante que par son origine identique — jamais pour HOME/BUILD/CONTROL
   (origine différente, déjà rechargées par la navigation cross-origine elle-même).
   Nouveau test unitaire pour la logique pure (`isSameOriginRedirect`,
   `redirectTarget.test.ts`) ; l'appel réel à `window.location.reload()` reste, par
   nature, non testable sous jsdom (navigation non implémentée) — **revérifié après
   correction par un second aller-retour navigateur complet, cette fois réussi**.
3. Après correction : back-office rendu réellement (`AppShell` dense, sidebar
   « Back-office », fil d'Ariane) — confirmé par `read_page`, pas une supposition.
4. Recherche « cible » → `GET /api/backoffice/users/?q=cible` réel → résultat
   affiché.
5. Sélection → `GET /api/backoffice/users/{id}/` réel → organisation/rôle affichés
   (« Org Constructeur Verif — constructeur »), « Compte actif ».
6. Clic sur « Désactiver ce compte » → confirmation affichée (`AlertBanner` +
   « Confirmer la désactivation » / « Annuler »), **aucun appel réseau à ce stade**
   (vérifié via `read_network_requests` — le premier clic n'exécute rien).
7. Clic sur « Confirmer la désactivation » → `POST
   /api/backoffice/users/{id}/deactivate/` réel (200) → relecture réelle (`GET`) →
   « Compte désactivé » affiché, bouton de désactivation disparu.
8. **État réellement persisté vérifié directement en base** (`manage.py shell`,
   hors frontend) : `User.objects.get(email='cible-verif@example.com').is_active`
   → `False`.

Console navigateur revérifiée propre après un rechargement complet (les seules
erreurs observées pendant la session, `defaultRedirect is not defined`, sont un
artefact transitoire du Hot Module Replacement de Vite au moment de l'édition du
fichier — confirmé transitoire par un rechargement forcé sans aucune nouvelle erreur,
et par la suite de tests + `tsc --noEmit` qui restent propres).

**Nettoyage effectué après vérification** : `localStorage` vidé, onglet fermé,
serveurs Django/vite arrêtés, conteneur Postgres de vérification retiré
(`docker compose down`, volume conservé), `.env`/`venv` locaux non versionnés
(`.gitignore`), `.claude/launch.json` (contournement infructueux) supprimé pour ne
pas laisser une config qui ne fonctionne pas.

## Critères d'acceptation
- [x] Écran réservé à `admin_keyimmo`, réutilisant la dérivation de rôle (adaptée en
      version TRANSVERSE, voir décision n°1)
- [x] Recherche d'utilisateur, affichage organisation/rôle
- [x] Désactivation avec confirmation explicite (double confirmation dans l'UI)
- [x] Aucune action ne suggère un raccourci sur un `TrustEvent` — vérifié côté backend
      (garde déjà existante, ticket 011) ET côté frontend (nouveau test de scan)
- [x] `AppShell` (dense) et composants du design system existants réutilisés
- [x] Tests écrits avant de considérer le ticket terminé
- [x] Aucun fichier sous `backend/apps/` modifié
- [x] Mapping `resolveRedirectApp` documenté explicitement comme une évolution
      volontaire, pas un oubli silencieux (ticket 020 + ce ticket)

## Explicitement hors scope
- Réactivation d'un compte désactivé (aucun endpoint backend pour ça au ticket 011)
- Modification d'organisation/rôle depuis le back-office (les endpoints du ticket 011
  sont strictement lecture seule sur ce point)
- Pagination/tri de la recherche utilisateur (le backend renvoie une liste simple, sans
  pagination — rien à ajouter côté frontend qui n'existe pas côté backend)
- Corriger l'outillage `preview_start` lui-même (bug d'environnement Windows, voir
  « Vérification » ci-dessus) — un contournement manuel a suffi pour ce ticket, la
  dette outillage reste à lever séparément avant tout pilote réel

## Dépendances
Ticket 007 (`AlertBanner`, `AppShell` dense), ticket 011 (les trois endpoints
back-office et leur garde anti-TrustEvent), ticket 019 (App Switcher — pattern de
dérivation de rôle depuis `/me`, adapté), ticket 020 (écran de connexion, mécanisme de
transfert de session par fragment — étendu pour qu'apps/web se consomme elle-même).
