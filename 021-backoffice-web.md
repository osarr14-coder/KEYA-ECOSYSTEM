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
  explicitement (voir ci-dessus).
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
  selon la présence d'un token en `localStorage`.
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
- **59 tests frontend** dans `apps/web` (35 nouveaux/modifiés au-delà des 21 du ticket
  020) : mapping de rôle (`redirectTarget.test.ts`), dérivation transverse
  (`adminAccess.test.ts`), client HTTP back-office (`client.test.ts`), réception de
  session (`receiveIncomingSession.test.ts`), bascule login/back-office et accès refusé
  (`App.test.tsx`), recherche/détail/confirmation/désactivation/garde anti-TrustEvent
  (`BackofficeView.test.tsx`). Suite complète du monorepo frontend revérifiée après coup
  (design-system, home, build, control-pwa) : aucune régression, `tsc --noEmit` propre.
- **Vérifié dans un vrai navigateur (Chrome via l'outil de preview)** : l'écran de
  connexion (`http://localhost:5176`, comportement du ticket 020) rendu sans erreur
  console, formulaire email/mot de passe intact. La bascule vers le back-office
  authentifié a été exercée via le rendu React complet des tests (jsdom + Testing
  Library — arbre de composants réel, interactions réelles), **pas** via un aller-retour
  Chrome complet avec un vrai backend : `preview_start` avec un `name` (lancement
  déclaratif du serveur de dev) échoue systématiquement dans cet environnement Windows
  dès que le chemin résolu de `npm`/`cmd` contient un espace (`C:\Program Files\...`) —
  confirmé indépendant de ce ticket en lançant `npm run dev --workspace=@keya/web`
  directement en Bash (démarre correctement, `EXIT:0`, aucune erreur). Contourné pour
  l'écran de connexion en démarrant le serveur en arrière-plan puis en pointant
  `preview_start` sur son URL directement. Un aller-retour authentifié complet aurait
  nécessité soit un vrai backend Postgres (RLS, migrations, utilisateurs seedés — hors
  scope, lourd à monter dans cet environnement, voir contraintes Docker déjà documentées
  au ticket 001), soit une interception réseau que les outils de preview ne permettent
  pas nativement. Assumé comme limite de cette vérification, pas comme un test sauté.

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
- Vérification manuelle en conditions réelles avec un vrai backend (voir « Vérification »
  ci-dessus — limite d'environnement, pas un choix de scope)

## Dépendances
Ticket 007 (`AlertBanner`, `AppShell` dense), ticket 011 (les trois endpoints
back-office et leur garde anti-TrustEvent), ticket 019 (App Switcher — pattern de
dérivation de rôle depuis `/me`, adapté), ticket 020 (écran de connexion, mécanisme de
transfert de session par fragment — étendu pour qu'apps/web se consomme elle-même).
