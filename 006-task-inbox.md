# Ticket 006 — Task Inbox transversale

## Objectif
Chaque utilisateur voit, en un seul endroit, toutes les actions qui lui incombent tous
modules confondus, avec une distinction claire entre les quatre types définis en V3.0
(15.2) : Notification (information), Task (action attendue), Alert (attention),
Exception (écart opérationnel).

## Entités touchées
- `Task` (polymorphe vers tout objet métier)
- `Notification`
- Émetteurs d'événements : ticket 003 (TrustEvent), ticket 005 (Reserve)

## Scope inclus
- `Task` : `type` (task/notification/alert/exception), `subject_type`, `subject_id`,
  `program_id`, `assignee_id`, `source`, `due_date`, `priority`, `status`
- Un `TrustEvent` de type "réserve ouverte" génère automatiquement une `Task` pour le
  constructeur assigné au lot
- Endpoint `GET /me/tasks` filtrable par type, statut, programme
- Une `Task` liée à une décision qui n'appartient pas à KEYIMMO (ex: "décision bancaire
  attendue") ne doit jamais avoir de statut suggérant que KEYIMMO tranche à la place de
  l'acteur compétent — le libellé doit toujours nommer l'acteur responsable

## Critères d'acceptation
- [ ] Les 4 types (task/notification/alert/exception) sont visuellement et
      structurellement distincts, jamais fusionnés dans une même liste non typée
- [ ] Aucune tâche générée par le système n'attribue implicitement une décision à
      KEYIMMO — vérifié par une revue des libellés générés, pas seulement du code
- [ ] Marquer une tâche comme traitée ne supprime jamais l'événement source

## Explicitement hors scope
- Notifications push/email — le MVP peut se limiter à l'inbox in-app
- Priorisation automatique par algorithme — priorité définie par règle simple au départ

## Dépendances
Tickets 003 et 005.
