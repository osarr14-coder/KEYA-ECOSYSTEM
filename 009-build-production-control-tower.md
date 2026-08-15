# Ticket 009 — BUILD : Production Control Tower

## Objectif
Un responsable constructeur/sponsor identifie immédiatement les exceptions qui
bloquent la production et peut agir depuis l'écran — critère d'acceptation produit
26.2 de la V3.0.

## Scope inclus
- Vue "Exceptions" par défaut (pas les KPI) : lots en retard, contrôles à planifier,
  capacités manquantes, réserves ouvertes, documents manquants — chaque ligne pointe
  vers une action concrète (endpoint existant : replanifier, ouvrir la réserve, etc.)
- Vue "Tous les lots" : tableau avec tri, filtres, densité réglable (utilise les tokens
  du ticket 007), pagination — pas de version simplifiée sans tri/filtre, c'est un
  écran d'usage intensif (V3.0 6.3)
- `AppShell` en variante dense

## Critères d'acceptation
- [ ] Les exceptions apparaissent au-dessus de tout indicateur agrégé (KPI), jamais
      l'inverse, y compris si aucune exception n'est présente (afficher un état vide
      explicite plutôt que de faire remonter les KPI par défaut)
- [ ] Aucune action disponible dans cet écran ne permet à un rôle constructeur de
      modifier directement le statut d'une réserve (garde déjà posée au ticket 005,
      à vérifier aussi côté UI : le bouton ne doit pas exister)
- [ ] Le tableau "Tous les lots" reste utilisable (perçu comme rapide) au-delà de
      200 lignes de test

## Explicitement hors scope
- Export CSV/Excel — utile mais non bloquant pour valider le critère 26.2
- Vues sauvegardées personnalisées

## Dépendances
Tickets 002, 003, 004, 005, 006, 007.
