# B-043 — Notifier le prospect de la décision sur sa demande de programme

## Contexte

Demande explicite utilisateur : « Notifie le prospect quand sa demande
est acceptée ou refusée ». F-058 documentait ce point comme un gap
délibérément différé (« le prospect consulte son statut en revenant sur
l'écran »). Aucun système d'e-mail/push n'existe dans ce projet (aucun
`EMAIL_BACKEND`, aucun `send_mail`, vérifié avant conception). La
plateforme possède déjà un vocabulaire de notification interne, `Task`
(ticket 006), avec un type `TaskType.NOTIFICATION` prévu mais jamais
utilisé jusqu'ici — c'est le mécanisme réutilisé ici, pas un système
parallèle.

## Scope

- **`backend/apps/tasks/services.py`** — `_program_request_decided_label`
  (ajouté à `LABEL_GENERATORS`, couvert automatiquement par le test de
  garde `TestNoTaskLabelGeneratorAttributesDecisionToKeyimmo` — vérifié
  qu'aucune des deux formulations (« a été acceptée »/« a été refusée »)
  ne contient une phrase interdite) et `create_task_for_program_request_
  decided(program_request)`, même schéma que `create_task_for_reserve_
  opened` (assigné à un AUTRE acteur que l'appelant, ici `program_request.
  requested_by`) : `type=NOTIFICATION` (premier générateur à utiliser ce
  type des 4 prévus par la doctrine ticket 006), `organization` = celle du
  PROSPECT, dédup via `(subject_type, subject_id, source='program_request_
  decided')` (ticket 017).
- **`backend/apps/programs/services.py::decide_program_request`** —
  appelle `create_task_for_program_request_decided` (import local, même
  convention que `apps.procurement.services`) APRÈS l'écriture du
  nouveau statut mais AVANT la restauration du contexte RLS vers
  l'organisation de l'admin : `tasks_task` n'a qu'une policy RLS
  mono-organisation (contrairement à `Litige`, ticket B-041), la Task
  doit donc être écrite PENDANT que le contexte RLS est déjà celui de
  l'organisation cible (même bascule explicite que le reste de la
  fonction, aucune nouvelle policy RLS ajoutée).

## Hors scope

- Aucun e-mail ni push — aucune infrastructure d'envoi n'existe dans ce
  projet, ajouter un `EMAIL_BACKEND` est un projet à part entière, pas un
  complément mineur à cette notification.
- Aucune capacité de marquer cette notification comme lue depuis
  `apps/home` — cette app n'a JAMAIS eu de bouton « traiter » sur ses
  `Task` (`MyActionsView.tsx`, purement lecture seule, ticket 008) : pas
  une régression introduite ici, un comportement déjà établi pour tout
  `Task` assignée à un rôle client/sponsor.
- Aucune notification lors de la SOUMISSION de la demande (côté
  `admin_keyimmo`) — seule la DÉCISION notifie ici, cohérent avec la
  demande utilisateur explicite.

## Critères d'acceptation

- Accepter une demande crée une `Task` `type=notification` assignée à
  `program_request.requested_by`, dans l'organisation du prospect.
- Refuser une demande fait de même, avec un libellé distinct.
- Aucun des deux libellés n'attribue la décision à KEYIMMO de façon
  interdite (couvert par le test de garde existant, ticket 006).
- Visible via l'endpoint déjà existant `GET /api/me/tasks/` — aucun
  nouvel endpoint.
- Suite backend verte, y compris le test de garde des libellés.
