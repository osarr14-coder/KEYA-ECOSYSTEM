# B-051 — Encaissements simulés, affectation, transitions de réservation (Phase 3)

## Contexte

Suite de B-050 (appels de fonds). CDC V3 R1 §6.1 (HELD→RESERVED→COMMITTED), §8.1
(encaissement acquéreur vers compte du programme), §8.3 (états, idempotence), tests T03,
T10 (entrées), T12. Jusqu'ici, RESERVED et COMMITTED étaient déclarés mais inatteignables
(B-048, « Ajustement de séquencement »).

## Règles du CDC et leur traduction

| CDC | Implémentation |
|---|---|
| « Finance enregistre un encaissement bancaire simulé » | `CustomerReceipt`, rôle `finance` seul ; naît à l'état « reçu en banque (simulé) » — l'état « prévu » est l'appel de fonds lui-même |
| « Une référence bancaire simulée est unique par instance, compte et sens du flux ; une répétition ne crée pas un second mouvement » (T10) | unicité `(organisation du programme, référence)` ; même référence rejouée à l'identique → mouvement existant renvoyé (200) ; rejouée avec d'autres données → refus (409), jamais une modification |
| « Après exécution, montant, devise et bénéficiaire sont immuables » | trigger en base : montant, devise, réservation, client, référence, date immuables ; statut en avant seulement ; aucune suppression |
| « affecte la somme à un ou plusieurs appels du même dossier » | `Allocation` (append-only), même dossier obligatoire |
| « Un versement partiel ne solde pas l'appel. Une somme non affectée reste explicitement non affectée » (T12) | appel « couvert » seulement si les affectations d'encaissements **rapprochés** atteignent son montant ; solde non affecté affiché ; affectation refusée au-delà du solde de l'encaissement OU du reste de l'appel (aucune double imputation), sous verrous de ligne |
| « Le rapprochement vérifie montant, devise, client, référence et affectations. Une anomalie bloque le rapprochement » | `reconcile` : contrôles explicites, refus motivé |
| « HELD → RESERVED : automatique après encaissement simulé rapproché et affecté aux frais » | réévaluation automatique après chaque affectation, rapprochement ou signature — jamais un bouton |
| « RESERVED → COMMITTED : contrat signé fictivement et premier versement intégralement couvert » (T03) | dernière version du contrat signée ET frais + complément couverts ; lot « vendu », `LotClient` créé |
| « Après enregistrement d'un encaissement, l'expiration automatique est suspendue pour revue Finance ; aucune libération ou restitution automatique » | un blocage avec encaissement n'expire plus et ne s'annule plus (désistement et remboursement hors MVP, A06) |

## Scope

- Modèles `CustomerReceipt`, `Allocation` (app `apps/sales`), RLS « organisation du lot OU
  client » (le client voit ses propres mouvements), garanties en base.
- Services : enregistrement idempotent, affectation, rapprochement, transitions
  automatiques ; `sign_contract_as_client` réévalue les transitions (la signature peut être
  la dernière condition).
- API Finance (`finance` seul en écriture, équipe KEYIMMO en lecture) : dossier financier
  d'une réservation, enregistrer / affecter / rapprocher. Liste des réservations ouverte en
  lecture à Finance (il doit pouvoir trouver les dossiers).
- Client : ses appels portent désormais le montant couvert et leur état (à payer,
  partiellement couvert, couvert).

## Simplifications assumées

- Justificatif bancaire : la référence simulée fait office de justificatif ; pas de pièce
  jointe (le dépôt de fichier est rattaché à l'organisation de l'appelant, pas à celle du
  programme — à traiter si demandé).
- Une affectation se fait aussi sur un encaissement déjà rapproché (pour son solde non
  affecté) : l'excédent n'est ainsi jamais perdu, et ne compte que s'il est affecté.

## Hors scope

- Visibilité, dans les écrans de suivi de chantier existants de HOME, d'un lot concrétisé
  appartenant à l'organisation du promoteur (ils lisent sous le contexte RLS du client) :
  `LotClient` est bien créé, l'affichage relève d'un ticket dédié.
- Décaissements vers le constructeur : B-052.

## Critères d'acceptation

- **T03** : frais 100 000 seuls → RESERVED ; complément 2 900 000 rapproché + contrat signé →
  COMMITTED, dans n'importe quel ordre ; total premier versement 3 000 000, sans double
  imputation.
- **T12** : versement partiel → appel non couvert ; excédent → non affecté, jamais
  consommé deux fois.
- **T10 (entrées)** : même référence rejouée → aucun doublon ; deux affectations
  concurrentes sur le même encaissement → jamais au-delà de son montant.
- Blocage avec encaissement : ni expiration, ni annulation.
- Seul Finance enregistre, affecte, rapproche ; l'ADV et l'admin lisent.
- Suite backend verte.
