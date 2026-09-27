# B-048 — Réservation de lot (Phase 2) + journal d'audit

## Contexte

Demande utilisateur : « Démarre la Phase 2 » (`docs/audit-cdc-v3-mvp-ecart-vefa.md`,
Phase 2 — réservation et contrat). Référence : CDC V3 R1 §5 (`Reservation`,
`AuditEvent`), §6.1 (disponibilité et états), tests T01/T02. Aujourd'hui,
`Lot.commercial_status` est un simple drapeau posé à la main : aucun blocage, aucune
concurrence gérée, aucune expiration.

## Découpage de la Phase 2

| Ticket | Objet |
|---|---|
| **B-048 (ce ticket)** | Réservation, catalogue, journal d'audit — backend |
| B-049 | Contrat versionné (`ContractVersion`) — backend |
| F-066 | HOME : catalogue, réserver, mes réservations, signer le contrat |
| F-067 | apps/web : réservations et contrats côté ADV |

## Ajustement de séquencement (par rapport au plan d'audit)

Le CDC (§6.1) déclenche **HELD → RESERVED** « automatiquement après encaissement simulé
rapproché et affecté aux frais », et **RESERVED → COMMITTED** après contrat signé ET
premier versement couvert par des encaissements rapprochés. Ces encaissements
(`CustomerReceipt`/`Allocation`) sont des objets de la **Phase 3**. Les deux transitions
sont donc **déclarées** (états du modèle, comptés comme bloquants par la contrainte
d'unicité dès aujourd'hui, pour ne jamais avoir à la migrer) mais **atteintes en
Phase 3**. Aucune transition manuelle de remplacement n'est créée : le CDC interdit à
l'ADV de « déclarer un paiement exécuté » (§4).

Même raisonnement que le report du rôle `finance` en B-046. Conséquence : T03 reste
rouge jusqu'en Phase 3 ; T01 et T02 sont couverts ici.

## Scope

### Nouvelle app `apps/sales` — `Reservation`

- Champs : organisation (= celle du lot, dénormalisée), lot, client, statut, échéance de
  blocage (`held_until`), **prix et devise figés au blocage** (un changement ultérieur du
  prix du lot ne modifie jamais une réservation en cours), annulation (auteur, motif),
  dates.
- États : `requested`, `held`, `reserved`, `committed`, `expired`, `cancelled`.
  Bloquants : `held`, `reserved`, `committed`.
- **Anti-concurrence (T01)** : verrou de ligne sur le lot (`select_for_update`) pendant
  la demande — deux demandes simultanées sont sérialisées, la seconde voit le blocage et
  reçoit un refus explicite (409). Filet en base : index unique partiel « une seule
  réservation bloquante par lot ».
- **Expiration (T02)** : `held_until` = maintenant + durée de blocage (paramètre visible
  `RESERVATION_HOLD_HOURS`, défaut 24 h, CDC §6.1 — sans valeur juridique). Expiration
  appliquée à chaque accès (demande sur le lot, lecture client ou ADV) et par la commande
  `expire_reservations` (planifiable). Aucun traitement asynchrone requis pour qu'un
  blocage échu libère le lot.
- **Annulation** : `held` uniquement (aucun encaissement possible avant la Phase 3), par
  le client lui-même ou par l'ADV/admin (motif obligatoire pour ces derniers).
- **Synchronisation du lot** : blocage → `reserve`, expiration/annulation → `disponible`.
  Le statut manuel (F-064) reste modifiable **seulement** en l'absence de réservation
  bloquante (409 sinon) : il sert aux ventes hors plateforme, jamais à contourner le cycle.
- **RLS** : même précédent que `InspectionMission` (ticket 011) — `organization_id =
  organisation courante OU client_id = utilisateur courant` en lecture ; écriture sous
  bascule explicite vers l'organisation du lot (le client n'en est jamais membre). ADV :
  boucle de bascule organisation par organisation, jamais une policy large.

### Catalogue — `GET /api/catalog/lots/`

Lots **publiés** de toutes les organisations : statut `disponible` ET prix de vente
renseigné (critère minimal, aucun nouveau champ « publié »). Utilisateur authentifié.
Renvoie de quoi afficher la fiche et réserver (programme, bien, surface, prix, devise,
organisation).

### Nouvelle app `apps/audit` — `AuditEvent`

Journal append-only (CDC §5) : organisation, acteur (nul pour une action système comme
l'expiration), action, type et id d'objet, données (JSON), justification, date serveur.
Même garanties que `TrustEvent` (ticket 003) : RLS lecture/insertion par organisation,
aucune policy UPDATE/DELETE, triggers qui refusent toute modification. Utilisé dès ce
ticket par la réservation ; B-049 et la Phase 3 s'y brancheront.

### API

| Route | Qui | Effet |
|---|---|---|
| `GET /api/catalog/lots/` | authentifié | lots publiés |
| `POST /api/reservations/` | client | demande + blocage (201) ou refus (409) |
| `GET /api/me/reservations/` | client | ses réservations |
| `POST /api/me/reservations/{id}/cancel/` | client | annule sa réservation `held` |
| `GET /api/reservations/admin/` | admin, ADV | toutes les réservations |
| `POST /api/reservations/{id}/admin-cancel/?organization_id=` | admin, ADV | annulation motivée |

## Hors scope

- HELD → RESERVED / RESERVED → COMMITTED : Phase 3 (voir ci-dessus).
- `CustomerFile` (dossier client, contrôle d'identité simulé) et `DemoInstance` :
  Phase 4 (marquage et instances de démonstration). Le compte client tient lieu de
  dossier.
- Création de `LotClient` : à la concrétisation (COMMITTED), donc Phase 3.
- Visibilité des lots d'une autre organisation dans les écrans HOME existants (suivi de
  chantier) : ils lisent sous le contexte RLS du client ; à traiter avec la
  concrétisation.

## Critères d'acceptation

- **T01** — deux demandes simultanées sur le même lot (deux vraies connexions) : une
  seule réservation bloquante, refus explicite pour l'autre.
- **T02** — blocage échu : lot libéré, événement d'expiration conservé, nouvelle demande
  acceptée.
- Prix figé sur la réservation ; statut du lot synchronisé ; statut manuel refusé (409)
  pendant une réservation bloquante.
- Un client ne voit jamais la réservation d'un autre ; un membre ordinaire n'accède pas
  aux routes ADV.
- Journal : événements présents, toute modification ou suppression refusée par la base.
- Suite backend verte.
