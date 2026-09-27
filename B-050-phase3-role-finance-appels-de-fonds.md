# B-050 — Phase 3 : rôle Finance et appels de fonds VEFA

## Contexte

Demande utilisateur : « Démarre la Phase 3 » (`docs/audit-cdc-v3-mvp-ecart-vefa.md`,
Phase 3 — finance simulée, « le vrai cœur manquant »). Référence : CDC V3 R1 §4 (rôle
Finance), §5 (`PaymentSchedule`/`PaymentCall`, `CustomerReceipt`/`Allocation`,
`Disbursement`), §6.1 (HELD→RESERVED→COMMITTED), §8 (deux flux simulés), §9.1 (scénario
chiffré), tests T03, T07, T09-T12.

## Découpage de la Phase 3

| Ticket | Objet | Tests CDC |
|---|---|---|
| **B-050 (ce ticket)** | Rôle `finance`, acceptation technique d'un jalon, appels de fonds (frais, premier versement, paliers VEFA) | prépare T03 |
| B-051 | Encaissements simulés, affectation aux appels, rapprochement ; transitions HELD→RESERVED→COMMITTED ; `LotClient` à la concrétisation | T03, T10 (entrées), T12 |
| B-052 | Décaissements vers le constructeur : éligibilité (jalon accepté, aucune réserve ouverte), réservation de fonds, exécution simulée, rapprochement | T07, T09, T10 (sorties), T11 |
| F-068… | Écrans : Finance (apps/web), versements du client (HOME), confirmation de versement reçu (BUILD) | T19 |

## Décisions de ce ticket

### Rôle `finance` (reporté de B-046)

Créé maintenant : les objets financiers qu'il protège arrivent avec ce ticket. Même
sémantique transverse que `admin_keyimmo`/`gestionnaire_adv` (rôle dans n'importe quelle
membership). Le CDC sépare strictement les pouvoirs : **l'ADV émet les appels** (§8.1 :
« le gestionnaire émet un appel »), **Finance enregistre les mouvements** (B-051/B-052) ;
aucun des deux ne fait le travail de l'autre, et `admin_keyimmo` ne cumule PAS le rôle
Finance (CDC §4 : « les comptes démontrant des fonctions incompatibles sont distincts »).

### Appels de fonds : montants calculés, jamais saisis

Un appel porte une nature, un montant et une devise, une date d'émission, et pour un
versement de palier le code du palier légal. Les montants sont **calculés par le
serveur** à partir du prix figé de la réservation, jamais saisis — aucune erreur de
frappe possible sur un montant d'appel :

| Nature | Montant | Condition d'émission |
|---|---|---|
| `frais` — frais de réservation | `RESERVATION_FEE_AMOUNT` (100 000 XOF, CDC §9.1) | réservation `held` |
| `premier_versement` — complément du premier versement | plafond du premier palier × prix − frais (10 % de 30 000 000 − 100 000 = 2 900 000, CDC §9.1 : « ne pas déduire une deuxième fois les frais ») | réservation `reserved` (frais encaissés, B-051) — la signature du contrat conditionne la concrétisation (COMMITTED), pas l'appel (CDC §9.2, étapes 3-4) |
| `versement` — palier VEFA suivant | plafond cumulé du palier × prix − total déjà appelé | réservation `committed` ET **jalon de même code techniquement accepté** sur le lot |

Chaque nature n'est appelée qu'une fois par réservation (et par palier) : index unique
en base. Le total appelé ne dépasse jamais le plafond cumulé légal du palier — garantie
VEFA centrale (aucun appel au-delà de l'avancement réel du chantier).

### Barème : lien palier ↔ jalon par code

Le premier palier du barème actif du Country Pack est le premier versement (non lié à un
jalon). Chaque palier suivant est débloqué par l'acceptation technique du jalon **de
même code** (`fondations`, `gros_oeuvre`, `reception`, `livraison` pour le gabarit
Sénégal). Aucune clé étrangère (décision C de B-027 conservée) : un palier sans jalon
correspondant ne peut simplement pas être appelé, et le refus le dit.

### Acceptation technique d'un jalon (« dans sa version courante », CDC §8.2)

Nouvelle fonction partagée (`apps.inspections.services.is_milestone_technically_accepted`,
réutilisée par B-052) — vraie si et seulement si :
1. la dernière inspection de la dernière déclaration du jalon est `conforme` ;
2. aucune réserve ouverte par une inspection de ce jalon n'est encore ouverte ;
3. aucune pièce n'a été ajoutée à la déclaration APRÈS cette inspection (T07 : une pièce
   remplacée après acceptation rend l'acceptation caduque, nouvelle revue nécessaire).

### Barème de démonstration

Aucun barème n'a jamais été seedé (constat de l'audit). La commande
`seed_demo_payment_tiers` crée et active, pour le Country Pack Sénégal (le seul existant,
porté par toutes les organisations), un barème **de démonstration** : premier versement
10 % (CDC §9.1), fondations 35 %, gros œuvre 70 %, réception 95 %, livraison 100 %.
**Valeurs non validées juridiquement** (CDC §3 : « valeurs fictives de démonstration, sans
couverture juridique revendiquée »). Le passage à un Country Pack Côte d'Ivoire (A02)
relève de T18 (Phase 4, changement de version de Country Pack).

## API

| Route | Qui | Effet |
|---|---|---|
| `GET /api/reservations/{id}/payment-calls/admin/?organization_id=` | admin, ADV, finance | appels émis + prochain appel émissible |
| `POST …/payment-calls/admin/?organization_id=` | admin, ADV | émet l'appel suivant (`{"kind": …, "tier_code": …}`) |
| `GET /api/me/reservations/{id}/payment-calls/` | client | ses appels |

## Hors scope

- Encaissements, statut « soldé » d'un appel, transitions de réservation : B-051.
- Échéancier daté contractuel, relances, pénalités (A06, hors démonstration).

## Critères d'acceptation

- Frais 100 000 XOF émissibles sur une réservation bloquée ; complément 2 900 000 XOF
  (jamais 3 000 000) ; aucun appel en double.
- Un versement de palier est refusé tant que le jalon de même code n'est pas
  techniquement accepté, et accepté ensuite, pour le montant exact du palier.
- Une pièce ajoutée après l'acceptation rend le jalon non accepté (T07, partie
  construction).
- Seuls admin/ADV émettent ; Finance consulte ; le client ne voit que ses appels.
- Suite backend verte.
