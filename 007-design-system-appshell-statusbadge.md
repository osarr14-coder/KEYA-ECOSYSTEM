# Ticket 007 — Design system : AppShell et StatusBadge

## Objectif
Livrer les deux composants partagés qui conditionnent la cohérence visuelle de tout
le reste du produit, avant que BUILD et HOME ne soient construits en parallèle et ne
divergent.

## Package touché
`/packages/design-system`

## Scope inclus
- `AppShell` : sidebar de modules (repliable), topbar (recherche, sélecteur
  organisation/programme, compteur Task Inbox, avatar), fil d'Ariane. Variante dense
  (BUILD/FINANCE) et variante simplifiée (HOME) — un seul composant avec une prop de
  densité, pas deux implémentations séparées
- `StatusBadge` : 5 niveaux Visible Trust, chaque niveau porte une forme distincte en
  plus de la couleur (pas de dépendance à la seule couleur), popover au clic affichant
  source/date/acteur/scope à partir d'un `TrustEvent`
- Tokens de densité : deux jeux de valeurs (dense / confortable) consommés par
  `AppShell` et par tout composant de liste/tableau

## Critères d'acceptation
- [ ] `StatusBadge` reste distinguable en niveaux de gris (test de contraste sans
      couleur) — condition d'accessibilité non négociable
- [ ] `AppShell` en variante HOME n'affiche aucun module professionnel (BUILD, FINANCE,
      NOTARY) tant que l'utilisateur n'a pas le rôle correspondant
- [ ] Aucun écran développé après ce ticket ne redéfinit sa propre variante de badge de
      statut — un seul composant, une seule source de vérité visuelle

## Explicitement hors scope
- App Switcher multi-rôle complet (dépend de plusieurs rôles réels en usage)
- Mode sombre

## Dépendances
Ticket 003 (structure d'un TrustEvent, pour le contenu du popover StatusBadge).
Peut démarrer en parallèle des tickets backend 004-006.
