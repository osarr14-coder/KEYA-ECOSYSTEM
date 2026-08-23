# F-055 — Canevas de page, présence du topbar et des cartes

## Contexte

Retour utilisateur sur le back-office (écran « Recherche d'utilisateur »,
apps/web), après F-053/F-054 : le design restait plat par endroits malgré
la refonte. Cause identifiée : `body` (`GlobalStyles.tsx`) et `Card`/le
topbar `AppShell` partageaient tous la MÊME couleur (`neutral.surface`,
blanc pur) — aucun contraste entre le « canevas » de page et les éléments
posés dessus, donc rien ne « flotte » visuellement, quelle que soit
l'ombre déjà posée sur `Card` (F-053).

## Scope

- **`GlobalStyles.tsx`** — `body` passe de `neutral.surface` (blanc pur)
  à `neutral.background` (teinté, `#F9FAFB` clair / `#0F172A` sombre) :
  le canevas de page est désormais visuellement distinct des éléments
  « surface » (cartes, topbar).
- **`AppShell.tsx`** (topbar hors `brand`) — fond `neutral.surface`
  explicite (était transparent, donc confondu avec le nouveau canevas
  teinté) + `--keya-shadow-sm` : le topbar se détache du contenu en
  dessous. Lien Task Inbox et bouton mode sombre : chip discret
  (fond `neutral.background` + rayon 8px), uniquement hors `brand` (sur
  fond navy, un chip clair casserait le contraste blanc existant).
- **`Card.tsx`** — ombre `--keya-shadow-sm` → `-md` : avec le nouveau
  canevas teinté en dessous, `-sm` ne suffisait plus à faire ressortir la
  carte (retour utilisateur explicite « manque de présence »).
- **`apps/web/src/views/BackofficeView.tsx`** — texte d'aide affiché
  avant la première recherche (état `idle`), même ton que les états vides
  déjà existants de cette vue (« Aucun utilisateur trouvé. ») — comble le
  vide visuel sous la carte de recherche, aucun ajout fonctionnel.

## Hors scope

- Aucun changement de structure/logique, uniquement `style`/tokens
  visuels + un texte d'aide, comme F-053/F-054.
- Le libellé « KEYIMMO AFRIC » (AppShell) — confirmé par l'utilisateur
  comme raison sociale à conserver telle quelle, distincte de « KEYA »
  (nom produit, écran de connexion uniquement). Pas d'incohérence à
  corriger de ce côté.

## Critères d'acceptation

- Le canevas de page (fond derrière les cartes) est visuellement
  distinct des cartes/du topbar, dans les 4 apps, clair et sombre.
- Aucune régression sur les suites existantes (design-system, apps/web,
  apps/home, apps/build, apps/control-pwa).
- Vérifié en Chromium réel (back-office, clair et sombre).
