# Ticket 005 — Inspections et cycle de vie des réserves

## Objectif
Un inspecteur (bureau de contrôle) mène une inspection sur une preuve, peut la valider
avec ou sans réserve. Une réserve suit un cycle de vie explicite jusqu'à sa levée.
L'avis original d'un inspecteur n'est jamais modifié — seule une nouvelle inspection
peut faire évoluer le statut.

## Entités touchées
- `Inspection`
- `Reserve`
- États de `Reserve` : `ouverte` → `correction_proposee` → `nouvelle_inspection` →
  `levee` | `rejetee`

## Scope inclus
- `Inspection` : rattachée à une `Evidence` ou un `WorkDeclaration`, réalisée par un
  utilisateur avec rôle inspecteur, indépendante de l'organisation du constructeur
  (vérifier que l'inspecteur n'appartient pas à l'organisation constructeur du lot —
  règle d'indépendance du contrôle, V3.0 section 2.3)
- `Reserve` avec machine à état explicite (pas un champ booléen `is_open`)
- Le constructeur peut documenter une correction (créer une `Evidence` de correction)
  mais ne peut jamais changer directement le statut de la `Reserve` — seule une
  nouvelle `Inspection` peut la faire passer à `levee`
- Chaque changement d'état génère un `TrustEvent`

## Critères d'acceptation
- [ ] Un utilisateur avec rôle constructeur ne peut appeler aucun endpoint qui changerait
      directement le statut d'une réserve — testé explicitement comme tentative refusée
- [ ] L'historique complet d'une réserve (ouverte → corrigée → re-inspectée → levée)
      reste consultable en entier après la levée, rien n'est écrasé
- [ ] Une inspection ne peut être créée que par un utilisateur dont l'organisation
      diffère de celle du constructeur du lot concerné

## Explicitement hors scope
- Mode offline de la saisie d'inspection (ticket CONTROL PWA séparé)
- Notification automatique au constructeur (ticket Task Inbox)

## Dépendances
Tickets 003 et 004.
