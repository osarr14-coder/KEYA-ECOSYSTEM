# B-052 — Décaissements simulés vers le constructeur (Phase 3)

## Contexte

Suite de B-051 (encaissements). CDC V3 R1 §5 (objet `Disbursement`), §8.2 (décaissement du
compte du programme vers le prestataire), §8.3 (états, absence de confirmation, idempotence),
§9.1 (décaissement illustratif : 1 000 000 XOF au constructeur après acceptation), tests T07,
T09, T10 (sorties), T11.

## Règles du CDC et leur traduction

| CDC | Implémentation |
|---|---|
| « Finance prépare une demande liée au jalon et au prestataire affecté » | `Disbursement` (app `apps/sales`) : programme, lot, jalon, organisation bénéficiaire = organisation constructrice affectée au lot (`Lot.assigned_organization`) ou, à défaut, l'organisation du programme (auto-exécution par un promoteur-constructeur) ; rôle `finance` seul |
| « La demande suit `DRAFT → ELIGIBLE → EXECUTED_SIM` » ; annulation avant exécution → `CANCELLED` | statut de la **demande**, transitions vérifiées par le service ET par un trigger en base |
| « Finance déclenche le contrôle d'éligibilité ; le système réserve alors le montant » | `DRAFT → ELIGIBLE` si : jalon techniquement accepté dans sa version courante (`is_milestone_technically_accepted`), aucune réserve ouverte sur le lot, au moins une pièce sur la déclaration, disponible suffisant ; sinon refus motivé (409), la demande reste `DRAFT` |
| « Si l'acceptation technique devient caduque, la demande revient à DRAFT, sa réservation de fonds est libérée » (T07) | réévaluation à chaque lecture du compte, avant tout contrôle d'éligibilité et avant l'exécution : une demande `ELIGIBLE` dont le jalon n'est plus accepté revient à `DRAFT`, événement d'audit à l'appui |
| « Les conditions sont revérifiées à l'exécution » | `ELIGIBLE → EXECUTED_SIM` revérifie tout ; référence bancaire simulée et date obligatoires |
| « Aucune annulation silencieuse n'est possible après exécution » | trigger : `EXECUTED_SIM` et `CANCELLED` sont terminaux |
| « Le solde est calculé à partir des encaissements rapprochés, moins les sorties exécutées ; les demandes ELIGIBLE non exécutées réservent leur montant » | compte = le programme : encaissements rapprochés des réservations de ses lots − décaissements exécutés − décaissements `ELIGIBLE` = disponible |
| « Une transaction empêche que deux demandes consomment simultanément le même disponible » (T10) | verrou de ligne sur le programme pour toute opération qui consomme ou libère du disponible |
| « Une sortie exécutée reste déduite même si son rapprochement est encore en attente » | seul le statut de la demande (`EXECUTED_SIM`) compte, pas le statut de preuve |
| « Le statut de demande et le statut de preuve du mouvement sont distincts » ; `PLANNED → BANK_EXECUTED_SIM → RECONCILED_SIM`, `BENEFICIARY_CONFIRMED_SIM` possible après exécution | deux champs : `status` (demande) et `flow_status` (preuve) ; `flow_status` avance avec l'exécution, jamais en arrière |
| « La confirmation du prestataire n'est pas une preuve bancaire » | le constructeur (membre de l'organisation bénéficiaire, rôle `constructeur`) confirme la réception ; cela ne rapproche rien |
| « En l'absence de confirmation, Finance peut rapprocher manuellement … avec motif obligatoire « Confirmation bénéficiaire non reçue ». L'absence reste visible » (T11) | rapprochement sans confirmation refusé sans ce motif exact ; `beneficiary_confirmed_at` reste vide et l'API l'expose (`beneficiary_confirmation: absent`) |
| « Aucune temporisation ne déclenche automatiquement le rapprochement » | aucune tâche planifiée ; le rapprochement est toujours une action Finance |
| « Chaque requête d'enregistrement est idempotente. Une référence bancaire simulée est unique par … compte et sens du flux » | préparation : une seule demande ouverte (`DRAFT`/`ELIGIBLE`) par jalon — la même requête rejouée renvoie la demande existante (200), avec un autre montant elle est refusée (409) ; exécution : référence unique par programme dans la table des sorties, rejouée à l'identique → 200 sans second mouvement, sur une autre demande → 409 |
| « Après exécution, montant, devise et bénéficiaire sont immuables. Une anomalie bloque le rapprochement » | trigger : montant, devise, bénéficiaire, jalon, programme, référence et date d'exécution immuables une fois posés ; rapprochement bloqué si le bénéficiaire affecté au lot a changé depuis |

## Scope

- Modèle `Disbursement`, RLS « organisation du programme OU organisation bénéficiaire » (le
  constructeur voit les sorties qui le concernent), garanties en base.
- Services : compte du programme (solde détaillé), préparation, contrôle d'éligibilité,
  exécution, annulation, confirmation bénéficiaire, rapprochement, retour à `DRAFT` sur
  caducité.
- API Finance (écriture `finance` seul, lecture équipe KEYIMMO) : comptes des programmes, détail
  d'un compte (solde, jalons et leur éligibilité, décaissements), les cinq actions.
- API constructeur : ses décaissements, confirmation de réception.
- Scénario de démonstration (B-053) : le lot de démonstration est affecté explicitement au
  promoteur-constructeur, bénéficiaire des décaissements.

## Hors scope

- Écrans Finance (apps/web) et confirmation constructeur (BUILD) : F-068.
- Contrepassations, remboursements (CDC §8.3 : différés).
- Plafonnement du décaissement par jalon (poids du jalon × devis) : le CDC ne le demande pas ;
  seul le disponible du compte borne la sortie.

## Critères d'acceptation

- **T09** : réserve ouverte ou disponible insuffisant → refus, aucune exécution, jamais de solde
  négatif.
- **T07** : pièce ajoutée après acceptation → la demande `ELIGIBLE` revient à `DRAFT`, montant
  libéré, exécution refusée jusqu'à nouvelle acceptation.
- **T10 (sorties)** : exécution rejouée → aucun doublon ; deux contrôles d'éligibilité
  concurrents sur le même disponible → un seul réussit.
- **T11** : exécuté, sans confirmation, motif Finance → rapproché ; absence de confirmation
  conservée et visible.
- Scénario §9.1 : 3 000 000 encaissés et rapprochés, 1 000 000 décaissés au constructeur →
  disponible 2 000 000.
- Seul Finance prépare, contrôle, exécute, annule, rapproche ; seul le bénéficiaire confirme.
- Suite backend verte.
