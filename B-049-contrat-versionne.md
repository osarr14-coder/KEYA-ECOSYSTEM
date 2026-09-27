# B-049 — Contrat fictif versionné (Phase 2)

## Contexte

Suite de B-048 (Phase 2 de `docs/audit-cdc-v3-mvp-ecart-vefa.md`). Référence : CDC V3
R1 §4 (rôles), §5 (`ContractVersion`), §6.2 (contrat fictif), test T04. Aucun objet
contrat n'existe aujourd'hui.

## Règles du CDC (§6.2) et leur traduction

| CDC | Implémentation |
|---|---|
| `DRAFT → REVIEW → APPROVED → SIGNED_SIMULATED` | `ContractStatus`, transitions explicites dans `apps/sales/services.py` |
| « Le gestionnaire prépare, soumet et approuve le contenu » | rédaction, soumission, approbation : `admin_keyimmo`/`gestionnaire_adv` |
| « le client réalise la signature simulée » | signature : le client de la réservation, lui seul |
| « La version approuvée ne change pas lors de la signature » | contenu figé dès la soumission (`REVIEW`) ; la signature ne touche que les champs de signature |
| « Une correction après signature crée une nouvelle version […] sans écraser la précédente » | nouvelle version `n+1` en `DRAFT`, l'ancienne reste `SIGNED_SIMULATED` et consultable |
| « Ce circuit simplifié n'affirme aucune indépendance de validation juridique » | libellé « signature simulée » partout, aucune mention de validation juridique |

Retour en rédaction : une version en `REVIEW` peut revenir en `DRAFT` (le gestionnaire
corrige avant approbation) — le CDC ne l'interdit pas et le circuit simplifié en a besoin.
Une version `APPROVED` ne se modifie plus : toute correction passe par une nouvelle
version (même règle qu'après signature, pour ne jamais modifier un contenu approuvé).

**Quelle version est signable** (décision prise en implémentation, le CDC ne la tranche
pas) : **seule la dernière version** de la réservation, et seulement si elle est
`APPROVED`. Une nouvelle version peut être créée dès qu'aucune version n'est en cours
(`DRAFT`/`REVIEW`), y compris quand la précédente est approuvée mais pas encore signée :
celle-ci n'est alors plus signable, sans être modifiée. Évite d'inventer un cinquième
état (« remplacée ») absent du CDC.

## Scope

- `ContractVersion` (app `apps/sales`) : réservation, numéro de version, statut, contenu
  (texte), auteur, soumission, approbation (auteur, date), signature simulée (client,
  date). Organisation et client dénormalisés (RLS, même policy que `Reservation`).
- Unicité `(réservation, numéro)` ; **au plus une version en cours** (`DRAFT`/`REVIEW`)
  par réservation (index unique partiel).
- **T04 en base, pas seulement en Python** : trigger qui refuse toute modification du
  contenu hors `DRAFT` et toute modification d'une version signée — même doctrine que
  `TrustEvent`/`AuditEvent` (la garantie ne dépend pas du code applicatif).
- Préparation possible pour une réservation `held` ou `reserved` (au-delà, Phase 3 ;
  jamais pour une réservation expirée ou annulée).
- Chaque transition écrit un `AuditEvent` (B-048).
- Marquage : chaque version porte `simulation: true` dans l'API et les écrans afficheront
  « SIMULÉ — SANS VALEUR OPÉRATIONNELLE » (CDC §3.1).

### API

| Route | Qui | Effet |
|---|---|---|
| `GET /api/reservations/{id}/contracts/admin/?organization_id=` | admin, ADV | versions d'une réservation |
| `POST …/contracts/admin/?organization_id=` | admin, ADV | nouvelle version `DRAFT` |
| `PATCH /api/contracts/{id}/admin/?organization_id=` | admin, ADV | modifier le contenu (`DRAFT` seulement) |
| `POST /api/contracts/{id}/admin-transition/?organization_id=` | admin, ADV | `submit`, `back_to_draft`, `approve` |
| `GET /api/me/reservations/{id}/contracts/` | client | ses versions |
| `POST /api/me/contracts/{id}/sign/` | client | signature simulée (`APPROVED` seulement) |

## Hors scope

- Condition RESERVED → COMMITTED (contrat signé + premier versement) : Phase 3.
- Modèle de contrat pré-rempli par Country Pack (A09) : le contenu est saisi par le
  gestionnaire ; un gabarit pourra venir avec la configuration pays.
- Export PDF du contrat.

## Critères d'acceptation

- **T04** : modifier une version signée (API ou SQL direct) est refusé ; une nouvelle
  version est requise ; l'ancienne reste consultable.
- Le client ne signe que sa propre version approuvée ; l'ADV ne signe jamais.
- Un client ne voit jamais le contrat d'un autre, ni les brouillons et versions en revue du sien (travail interne du gestionnaire) : seulement les versions approuvées ou signées.
- Suite backend verte.
