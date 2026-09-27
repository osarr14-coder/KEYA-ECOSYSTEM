# F-070 — Déconnexion volontaire dans toutes les applications

## Contexte

Retour utilisateur : « je ne peux même pas me déconnecter ». Aucune app ne proposait de
déconnexion — seule la déconnexion forcée sur 401 existait (`forceLogout`). Impossible donc de
changer de compte (indispensable pour dérouler le scénario avec les 7 comptes de démonstration,
B-053) sans vider le stockage du navigateur à la main. Chaque app garde sa session dans le
`localStorage` de SA propre origine.

## Scope

- `@keya/design-system` : `logoutToLoginScreen()` efface la session de l'origine courante
  (jetons, organisation active — jamais la préférence de thème) et ouvre l'écran de connexion
  d'apps/web avec `?logout=1` ; `consumeLogoutRequest()` (apps/web, au démarrage) efface aussi
  la session d'apps/web, sans quoi un jeton d'admin/ADV/Finance resté là rouvrirait le
  back-office. `AppShell` : prop `onLogout` → bouton « Se déconnecter » dans la barre du haut.
- apps/web, HOME, BUILD : bouton branché ; apps/web l'affiche aussi sur « Accès refusé » et sur
  l'erreur de chargement du profil (jamais une impasse).
- CONTROL : bouton dans la barre de marque ; avertissement si des saisies ne sont pas
  synchronisées (elles restent sur l'appareil) ; cache des missions vidé (le compte suivant ne
  voit jamais celles d'un autre contrôleur).
- Mise en page (constatée en vérifiant) : avec 11 onglets, la barre d'onglets d'apps/web
  élargissait la page et poussait la barre du haut hors de l'écran. Colonne de contenu en
  `minmax(0, 1fr)`, barre d'onglets à défilement horizontal.

## Vérification

Navigateur : admin (apps/web) → « Se déconnecter » → écran de connexion ; client (HOME) →
« Se déconnecter » → écran de connexion d'apps/web, jamais le back-office.
