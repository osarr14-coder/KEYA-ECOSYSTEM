# Ticket 008 — HOME (client), lecture seule

## Objectif
Un client comprend en quelques secondes son bien, son avancement, l'événement récent,
le problème principal et sa prochaine action — critère d'acceptation produit 26.1 de
la V3.0, à vérifier littéralement à la fin de ce ticket avec un utilisateur test.

## Scope inclus
- Vue "Vue d'ensemble" : hero du bien (nom, programme, lot, localisation), progression
  dérivée des `Milestone`/`TrustEvent` (jamais recalculée côté frontend — consommée
  depuis un endpoint qui a déjà tranché), dernier événement notable
- Vue "Avancement & preuves" : liste chronologique des `Evidence` avec leur
  `StatusBadge` et provenance
- Vue "Mes actions" : sous-ensemble filtré de la Task Inbox (ticket 006) pour ce client
- `AppShell` en variante simplifiée (ticket 007)

## Critères d'acceptation
- [ ] Toute donnée affichée (progression, statut) provient d'un endpoint API qui a déjà
      calculé le résultat — aucun calcul de pourcentage ou de statut dans le frontend
- [ ] Le client ne voit aucune donnée d'un autre lot/bien que le ou les siens
- [ ] Un test utilisateur informel confirme que les 5 éléments du critère 26.1 sont
      identifiables sans explication en moins de 5 secondes

## Explicitement hors scope
- Financement, Documents avancés, Messages — modules optionnels mentionnés en V3.0
  5.2, à ajouter seulement si le noyau ci-dessus est validé

## Dépendances
Tickets 002, 003, 004, 006, 007.
