# Ticket 020 — Écran de connexion (apps/web)

## Statut
Livré. Troisième ticket de la branche `feature/frontend-improvements`. Remplace le
mécanisme manuel documenté depuis les tickets 008/009/010
(`localStorage.setItem('keya_access_token', '<jwt>')` posé à la main) par un vrai flux
de connexion.

## Objectif
Formulaire de connexion (email + mot de passe) consommant l'endpoint d'authentification
existant (`POST /api/auth/login/`, ticket 001), avec gestion des erreurs et redirection
post-connexion vers HOME, BUILD ou CONTROL selon le rôle réel de l'utilisateur (réutilise
la dérivation de rôle mise en place par l'App Switcher, ticket 019).

## Contexte et vérifications faites avant d'écrire du code
- **`apps/web` n'existait pas** — nouvelle app du monorepo (workspace `@keya/web`, port
  5176, premier port libre après HOME 5173/BUILD 5174/CONTROL PWA 5175).
- **Vérifié empiriquement** (pas supposé) : `POST /api/auth/login/` (`TokenObtainPairView`,
  simplejwt par défaut, aucun serializer personnalisé) renvoie EXACTEMENT le même 401
  générique (`"No active account found with the given credentials"`) pour identifiants
  invalides, compte désactivé (`is_active=False`, ticket 011) ET email inexistant —
  aucune distinction n'existe côté backend (comportement standard simplejwt,
  volontairement non distinctif : évite l'énumération de comptes). Le frontend affiche
  donc un seul message générique « Identifiants invalides. », jamais un message inventé
  que le backend ne fournit pas.
- **HOME/BUILD/CONTROL PWA sont des origines séparées** (ports différents, aucune config
  de déploiement partagée dans ce repo) : `localStorage` n'est jamais partagé entre elles.
  La redirection post-connexion transmet donc les jetons (`access`/`refresh`) via
  fragment d'URL (`#access_token=...&refresh_token=...`) — jamais en query string (visible
  côté serveur/logs), lu une seule fois par l'app cible puis retiré de l'URL.
- **CORS_ALLOW_HEADERS — bug réel trouvé en marge, pré-existant depuis le ticket 019** :
  la toute première vérification RÉELLE en navigateur (jamais faite au ticket 019, qui
  ne s'appuyait que sur des tests unitaires à `fetch` mocké) a révélé que
  `django-cors-headers` n'autorise, par défaut, que ses `default_headers` — le header
  personnalisé `X-Organization-Id` (`apps.core.middleware.OrganizationScopeMiddleware`,
  ticket 019) faisait donc échouer le préflight CORS SILENCIEUSEMENT dès qu'une
  organisation active était connue côté frontend (`fetch` lève une erreur réseau
  générique, jamais une réponse HTTP lisible — le symptôme observé en navigateur, très
  trompeur, ressemblait à des 503 aléatoires alors que le serveur Django ne loggait que
  des 200). Corrigé dans CE ticket (`config/settings.py::CORS_ALLOW_HEADERS`), puisque
  découvert en marge, exactement comme la discipline déjà établie sur ce projet
  (tickets 015/016/018).

## Entités touchées
- `apps/web/` — nouvelle app (scaffold complet : `package.json`, `vite.config.ts`,
  `tsconfig.json`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`,
  `src/api/{client,types,ApiClientContext}.ts(x)`, `src/auth/redirectTarget.ts`,
  `src/testUtils.tsx`)
- `apps/{home,build,control-pwa}/src/auth/receiveIncomingSession.ts` (nouveau, dans
  chaque app) — reçoit le fragment d'URL, remplace le mécanisme manuel
- `apps/{home,build,control-pwa}/src/main.tsx` — appelle `receiveIncomingSession()` avant
  tout le reste
- `backend/config/settings.py` — `CORS_ALLOW_HEADERS` (bug pré-existant corrigé en marge)
- `backend/apps/core/tests.py` (nouveau contenu — vide auparavant) — test de
  non-régression du préflight CORS
- `backend/.env` (local, non versionné) et `.env.example` — port 5176 ajouté à
  `CORS_ALLOWED_ORIGINS`

## Scope livré
1. **Formulaire de connexion** (email + mot de passe), `apps/web/src/App.tsx`. Réutilise
   `AlertBanner` (design system, ticket 007) pour l'affichage d'erreur — aucun nouveau
   composant de formulaire dans le design system, qui n'en avait pas déjà avant ce ticket
   (`AppShell`/`StatusBadge`/`AlertBanner` seulement) ; champs HTML natifs, même
   convention que HOME/BUILD.
2. **Gestion des erreurs** : un 401 (identifiants invalides — indistingable d'un compte
   désactivé, vérifié ci-dessus) affiche « Identifiants invalides. » ; toute autre erreur
   (réseau, 500...) affiche un message générique distinct « Une erreur est survenue.
   Réessayez. » — jamais un message qui prétend distinguer ce que le backend ne
   distingue pas.
3. **Redirection post-connexion selon le rôle réel** (`auth/redirectTarget.ts`) : après
   connexion, `GET /api/me/` résout la PREMIÈRE membership (même convention que le
   fallback de l'App Switcher, ticket 019, et le défaut backend sans
   `X-Organization-Id`) ; mapping délibéré et documenté : `inspecteur` → CONTROL,
   `constructeur` → BUILD, tout autre rôle (`client`, `sponsor`, `admin_keyimmo`, ou
   aucune membership) → HOME (aucun des deux autres n'a d'app dédiée déployée
   aujourd'hui — `FINANCE`/`NOTARY` restent des modules `AppShell`, ticket 007, jamais
   des apps réelles).
4. **Remplace le mécanisme localStorage manuel, sans casser la persistance de
   l'organisation active** : `receiveIncomingSession()` (dans chaque app réceptrice)
   écrit sous la MÊME clé `keya_access_token` que le mécanisme manuel qu'il remplace —
   `getActiveOrganizationId`/`keya_active_organization_id` (ticket 019) reste
   intégralement inchangé, testé explicitement (`receiveIncomingSession` ne touche
   jamais cette clé).

## Vérification manuelle en conditions réelles (navigateur, backend réel)
Trois comptes réels créés (constructeur/inspecteur/désactivé), backend + 4 serveurs de
dev lancés :
- Connexion constructeur → redirection réelle vers BUILD (port 5174), token en
  localStorage, fragment d'URL nettoyé, sidebar BUILD visible (rôle correctement dérivé).
- Connexion inspecteur → redirection réelle vers CONTROL (port 5175), missions réelles
  affichées.
- Connexion compte désactivé → « Identifiants invalides. » affiché, aucune redirection.
- **C'est cette vérification qui a révélé le bug `CORS_ALLOW_HEADERS`** ci-dessus — les
  tests unitaires (fetch mocké) ne l'auraient jamais détecté.

## Critères d'acceptation
- [x] Formulaire email + mot de passe, consomme `POST /api/auth/login/`
- [x] Gestion des erreurs vérifiée contre le VRAI comportement backend (pas supposée) —
      identifiants invalides et compte désactivé produisent le même 401, traité comme
      un seul cas ; toute autre erreur a un message distinct
- [x] Redirection post-connexion vers HOME, BUILD ou CONTROL selon le rôle réel,
      réutilisant la dérivation de rôle de l'App Switcher (ticket 019)
- [x] Mécanisme localStorage manuel remplacé, `keya_active_organization_id` (ticket 019)
      jamais cassé — testé explicitement
- [x] Composants du design system existants réutilisés (`AlertBanner`)
- [x] Tests écrits avant de considérer le ticket terminé (client HTTP, mapping
      rôle→app, formulaire, réception de session dans les 3 apps réceptrices) — 181
      tests frontend au total (dont 33 nouveaux : 21 `apps/web`, 6 par app réceptrice
      HOME/BUILD, 5 CONTROL PWA)
- [x] Vérifié en conditions réelles (navigateur + backend réel), pas seulement en tests
      unitaires — a révélé et corrigé un bug CORS réel pré-existant, désormais couvert
      par un test de non-régression (`apps/core/tests.py::TestCorsAllowsCustomHeaders`)
- [x] Suite backend complète verte (188 tests — 186 + 2 nouveaux)

## Explicitement hors scope
- Flux de rafraîchissement automatique du token (`refresh_token` stocké pour usage
  futur, mais aucun mécanisme de renouvellement construit — aucune app ne gère
  aujourd'hui l'expiration du token, hors scope de ce ticket)
- Inscription (`register`) — déjà accessible via l'API (ticket 001), aucun écran
  frontend demandé pour ce ticket
- Mot de passe oublié / réinitialisation
- Vraie config de déploiement partagée (même domaine, reverse proxy) qui rendrait le
  transfert par fragment d'URL inutile — le mécanisme actuel reste correct quel que
  soit le déploiement réel futur (transparent à ce détail)

## Dépendances
Ticket 001 (`POST /api/auth/login/`, `GET /api/me/`), ticket 007 (`AlertBanner`), ticket
011 (désactivation de compte, `is_active`), ticket 019 (App Switcher — dérivation de
rôle réutilisée, `keya_active_organization_id` à préserver).

## Évolution ticket 021
Le mapping `resolveRedirectApp` décrit au point 3 du scope livré ci-dessus (« tout autre
rôle [...] → HOME ») a changé au ticket 021 : `admin_keyimmo` gagne sa propre branche →
`web` (apps/web héberge désormais le back-office, voir `021-backoffice-web.md`). **Ce
n'est PAS un oubli de CE ticket** : au moment où ce ticket 020 a été livré, `apps/web`
n'avait strictement aucun écran post-connexion (uniquement le formulaire de connexion
ci-dessus) — aucune destination `web` ne pouvait donc exister, et `admin_keyimmo`
retombait légitimement, comme tout rôle sans app dédiée à l'époque, sur HOME par défaut.
« Tout autre rôle → HOME » reste vrai pour CHAQUE rôle SAUF `admin_keyimmo` depuis le
ticket 021. Le reste de ce ticket (formulaire, gestion des erreurs, mécanisme de
transfert de session par fragment d'URL, remplacement du `localStorage` manuel) est
strictement inchangé.
