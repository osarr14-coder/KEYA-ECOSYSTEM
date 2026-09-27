# B-054 — API chantier : jalons côté constructeur, contrôles à affecter, contrôleurs

## Contexte

Le scénario du CDC V3 §9.1 (étapes 5-6 du parcours §9.2 : déclaration, pièce, contrôle,
réserve, levée) existe côté backend depuis les tickets 004/005/012/013, mais deux écrans
manquent pour le dérouler sans intervention serveur (constat de F-068) :

- le constructeur ne peut pas **déclarer** un jalon depuis BUILD (il ne voit pas la liste des
  jalons d'un lot, ni leur état) ;
- l'admin ne peut pas **affecter une mission** au contrôleur depuis apps/web (il ne voit ni les
  déclarations à contrôler, ni la liste des contrôleurs).

Ce ticket fournit les lectures nécessaires ; les écritures existent déjà
(`POST /api/work-declarations/`, `/api/documents/` + `/api/evidences/`,
`POST /api/backoffice/missions/`, synchronisation CONTROL).

## État d'un jalon (CDC §7.1), toujours dérivé, jamais stocké

Calculé sur la DERNIÈRE déclaration du jalon :

| État | Condition |
|---|---|
| `not_declared` | aucune déclaration |
| `awaiting_documents` | déclaration sans pièce (un dépôt seul n'accepte jamais les travaux, et une déclaration sans pièce ne se contrôle pas) |
| `accepted` | `is_milestone_technically_accepted` (avis conforme, aucune réserve ouverte, aucune pièce postérieure) |
| `under_reserve` | réserve ouverte par une inspection de cette déclaration |
| `awaiting_control` | autres cas : pièces présentes, pas encore accepté (jamais contrôlé, ou pièce ajoutée après l'avis — T07) |

S'y ajoutent : nombre de pièces, dernier avis, correction proposée sur la réserve, et la
**mission en cours** (affectée, sans inspection de l'inspecteur assigné postérieure à
l'affectation — même règle que la liste des missions de CONTROL, ticket 014).

## Scope

- `GET /api/build/lots/{id}/milestones/` — jalons d'un lot de l'organisation active avec leur
  état ; 404 pour un lot d'une autre organisation.
- `GET /api/backoffice/controls/` (admin) — déclarations `awaiting_control` ou `under_reserve`,
  toutes organisations, avec la mission en cours.
- `GET /api/backoffice/inspectors/` (admin) — comptes détenant le rôle `inspecteur`, avec leurs
  organisations (pour l'affectation ; la règle d'indépendance reste vérifiée par
  `create_mission`).

## Simplification assumée

La liste des contrôleurs lit les memberships utilisateur par utilisateur (la policy RLS
`membership_select` n'autorise que ses propres lignes, choix du ticket 001 conservé) : coût
linéaire acceptable à l'échelle du MVP.

## Critères d'acceptation

- Un jalon passe `not_declared` → `awaiting_documents` → `awaiting_control` → `under_reserve`
  (avis avec réserve) → `awaiting_control`/`accepted` selon la correction et le recontrôle.
- Une mission affectée apparaît « en cours » jusqu'à l'inspection de l'inspecteur assigné.
- Constructeur : jamais les jalons d'un lot d'une autre organisation. Contrôles et contrôleurs :
  admin seul.
