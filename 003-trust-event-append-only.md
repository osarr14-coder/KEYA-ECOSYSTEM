# Ticket 003 — TrustEvent append-only et chaîne de provenance

## Statut
Ticket fondateur pour toute la doctrine Visible Trust. À traiter tôt, avant que d'autres
modules ne soient tentés d'écrire leur propre système de statut ad hoc.

## Objectif
Tout changement d'état de confiance sur un objet métier crée un événement immuable,
jamais une mise à jour. Le statut affiché d'un objet est toujours dérivé de son dernier
événement, jamais stocké comme vérité indépendante.

## Entités touchées
- `TrustEvent` (append-only strict)
- Colonne polymorphe `subject_type` / `subject_id` référençant l'objet concerné
  (Milestone, WorkDeclaration, Evidence, Reserve...)

## Scope inclus
- Table `trust_event` : `id`, `subject_type`, `subject_id`, `level`
  (déclaré/documenté/contrôlé/vérifié/validé), `actor_id`, `source`, `scope`,
  `created_at`, `previous_event_id` (nullable, pour chaîner une correction)
- Repository exposant uniquement `create` et des méthodes de lecture — aucune méthode
  `update` ni `delete` ne doit exister sur ce repository
- Fonction de résolution `getCurrentStatus(subject)` qui retourne le dernier événement
  valide pour un objet donné
- Test de garde qui échoue si une migration ajoute un trigger ou une contrainte
  permettant un UPDATE/DELETE sur `trust_event`

## Critères d'acceptation
- [ ] Impossible de modifier ou supprimer un `TrustEvent` existant, y compris par un
      rôle admin — vérifié par un test qui tente explicitement l'opération
- [ ] Une correction (ex: réserve levée après nouvelle inspection) crée un nouvel
      événement avec `previous_event_id` renseigné, l'événement original reste inchangé
- [ ] `getCurrentStatus` ne fait jamais de calcul de score — il retourne un des 5 niveaux
      Visible Trust avec sa provenance complète (source, date, acteur, scope), jamais
      un pourcentage

## Explicitement hors scope
- UI d'affichage (StatusBadge) — ticket séparé côté design system
- Notifications déclenchées par un nouvel événement — ticket Task Inbox

## Dépendances
Ticket 001. Peut être développé en parallèle du ticket 002.
