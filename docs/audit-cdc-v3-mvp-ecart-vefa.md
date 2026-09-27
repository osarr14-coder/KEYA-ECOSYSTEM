# Audit — Cahier des charges V3 MVP investisseurs vs code existant

### Écarts identifiés et plan proposé pour se rapprocher de la logique VEFA

> **⚠️ CECI EST UNE PROPOSITION, PAS UNE DÉCISION FINALE.** Ce document classe des écarts
> et propose un plan à valider avant toute action — même registre que
> `docs/gate3-classement-angles-morts.md`. Aucune ligne ci-dessous n'engage de travail
> tant qu'elle n'a pas été confirmée, ajustée ou rejetée par le Product Owner.

| Champ | Valeur |
|---|---|
| Date | 27 septembre 2026 |
| Statut | PROPOSITION — audit + plan, non validé |
| Document analysé | `KEYIMMO_AFRIC_CDC_V3_MVP_REVISION_R1.md` (V3, révision R1, 19 septembre 2026) |
| Méthode | Lecture du code réel (modèles, vues, migrations, tests) — jamais une supposition sur ce qui "devrait" exister |
| Documents de référence croisés | `CLAUDE.md`, `docs/gate3-classement-angles-morts.md`, `docs/economie/KEYIMMO_Modele_Economique_Consolide.md` |

## Contexte

Demande explicite : identifier, dans le cahier des charges V3 MVP investisseurs (Côte
d'Ivoire, entièrement simulé), les points pertinents qui n'ont pas encore été
développés dans ce projet, et proposer un plan pour rapprocher le modèle de la logique
VEFA. Ce document fait suite à un premier audit (même session, jamais formalisé en
fichier) qui avait déjà établi : la chaîne Visible Trust et le verrouillage des devis
sont solides, mais rien ne modélise le cycle de vente lui-même (contrat, paiement,
notaire, banque). Le CDC V3 rend ce constat beaucoup plus précis et actionnable — il
fournit une machine à états, un modèle de domaine et 20 tests d'acceptation concrets
là où l'audit précédent ne pointait qu'un manque général.

## Tension de cadrage à trancher en premier

Ce CDC décrit un **produit différent** de ce qui existe :

- **Un MVP de démonstration entièrement simulé** — `environment: DEMO`, `simulation:
  true` partout, "aucune opération immobilière ou financière réelle" (§0). Le code
  actuel est une plateforme réelle, sans aucune notion de démonstration ou de
  simulation.
- **Côte d'Ivoire** (A02) comme pays de démarrage. Le code actuel n'a qu'un seul
  `CountryPack` seedé : Sénégal (`apps/organizations/migrations/
  0003_seed_senegal_country_pack.py`). Aucun pack Côte d'Ivoire n'existe.

Le CDC lui-même (§11) donne la marche à suivre : *"inspecter le dépôt réellement
accessible... ne pas reconstruire automatiquement l'application ni présumer que
l'ancien code est conforme."* Conclusion de cet audit : **le socle existant est
réutilisable tel quel** — Trust chain, RLS, jalons, devis verrouillé. Ce qui manque est
une couche "cycle de vente + finance + démonstration" par-dessus, pas une réécriture.

## Tableau des écarts

Légende : 🟢 couvert · 🟡 partiellement couvert / fondation présente sans le mécanisme
complet · 🔴 absent.

### Rôles (§4 du CDC)

| Rôle CDC | État | Écart |
|---|---|---|
| Client | 🟢 | `client`, app HOME |
| Constructeur | 🟢 | `constructeur`, app BUILD |
| Bureau de contrôle | 🟢 | `inspecteur`, CONTROL PWA + `ControlOfficeRate` |
| Gestionnaire programme/ADV | 🔴 | N'existe pas distinctement d'`admin_keyimmo`, qui cumule aujourd'hui la création de programme, la décision sur les demandes, et demain la finance. Le CDC exige explicitement la séparation ("comptes démontrant des fonctions incompatibles sont distincts"). |
| Finance démo | 🔴 | Aucun rôle, aucun objet financier à gérer de toute façon (voir plus bas). |
| Administrateur démo | 🟡 | `admin_keyimmo` en fait office, mais sans la distinction "provisionner/archiver une instance" vs "pouvoir métier" que le CDC exige. |

### Modèle de domaine (§5) et cycle réservation/contrat (§6)

| Objet CDC | État | Écart |
|---|---|---|
| `DemoInstance` | 🔴 | Aucune notion d'instance de démo, de marquage, ni d'archivage. |
| `Reservation` (`REQUESTED→HELD→RESERVED→COMMITTED`, blocage atomique anti-concurrence, expiration) | 🔴 | `Lot.commercial_status` (`apps/programs/models.py`) est un simple flag à 3 valeurs (`disponible/réservé/vendu`), posé à la main. Aucune machine à états, aucun blocage horodaté, aucune gestion de concurrence. Les tests T01/T02 du CDC échoueraient immédiatement aujourd'hui. |
| `ContractVersion` (`DRAFT→REVIEW→APPROVED→SIGNED_SIMULATED`, versionné, jamais écrasé) | 🔴 | Confirmé absent — aucun objet contrat. `LotClient` (le lien client↔lot) n'a même **aucune API d'écriture** ; il se crée uniquement à la main en base (`apps/programs/models.py`, docstring `LotClient`). |
| `CountryPackVersion` avec statut `DEMO_NOT_LEGALLY_VALIDATED` | 🟡 | Le mécanisme `CountryPack` est générique et versionné (`MilestoneTemplate`, `LegalPaymentTierTemplate`), mais aucun statut de ce type n'existe sur le pack lui-même. |

### Construction et confiance (§7)

| Élément CDC | État | Écart |
|---|---|---|
| États de travail du jalon (`DRAFT→SUBMITTED→UNDER_REVIEW→TECHNICALLY_ACCEPTED`, branche `CHANGES_REQUIRED→RESUBMITTED`) | 🟢 | Couvert en substance par `WorkDeclaration→Evidence→Inspection→Reserve→ReserveCorrection` (tickets 002-009). Les noms d'état diffèrent mais la logique (déclaration → examen → réserve → correction → recontrôle) existe et fonctionne. |
| Niveaux de confiance (Déclaré/Documenté/Contrôlé/Vérifié/Validé) | 🟢 | Correspondance quasi exacte avec `TrustLevel` (ticket 003, `apps/trust/models.py`). |
| Séparation stricte déclarant/contrôleur (le constructeur ne peut ni accepter ses travaux ni lever sa réserve) | 🟢 | Déjà garanti structurellement — `IsInspecteur` gate la création d'`Inspection`, un constructeur n'a pas accès à cette route. |

### Deux flux financiers (§8)

| Élément CDC | État | Écart |
|---|---|---|
| `PaymentSchedule` / `PaymentCall` (calendrier d'appels de fonds lié au contrat) | 🔴 | `LegalPaymentTierTemplate`/`LegalPaymentTierStep` (ticket B-027) modélise le barème légal — mais c'est une table de RÉFÉRENCE, **jamais seedée pour aucun pays**, jamais connectée à un contrat ni à un appel de fonds réel. Aucun autre fichier du projet ne la référence en dehors d'`apps/pricing`. |
| `CustomerReceipt` / `Allocation` (encaissement simulé, affectation aux appels, gestion du partiel) | 🔴 | Rien n'enregistre un encaissement ni ne l'affecte. |
| `Disbursement` (`DRAFT→ELIGIBLE→EXECUTED_SIM`, éligibilité liée au jalon accepté + aucune réserve ouverte + solde suffisant, verrouillage anti-double-dépense) | 🔴 | `LotLedger` (ticket B-035) calcule une marge à la volée (foncier/BE/construction) — c'est une vue interne KEYIMMO, pas un objet de décaissement avec état, éligibilité vérifiée ou verrouillage de solde. |

### Démonstration, indicateurs, sécurité (§9-10)

| Élément CDC | État | Écart |
|---|---|---|
| Écran indicateurs (jalons examinés, paiements rapprochés, réserves, pièces — en ratio, "Non applicable" si dénominateur nul) | 🔴 | Aucun écran comparable. BUILD a une vue "Exceptions" proche en esprit, pas ces ratios précis. |
| `AuditEvent` (journal immuable de TOUTE action critique, pas seulement la construction) | 🟡 | `TrustEvent` est déjà append-only et RLS-protégé (aucune policy `UPDATE`/`DELETE`) mais ne couvre QUE la chaîne Visible Trust — aucune trace des actions admin, contractuelles ou financières une fois qu'elles existeront. |
| Upload de fichiers restreint (PDF/JPEG/PNG, 10 Mo max, scan, quarantaine) | 🔴 | Vérifié dans le code (`apps/evidence/models.py`) : **aucune validation de type ni de taille** à l'upload aujourd'hui. Seul bon point : l'accès aux fichiers passe déjà par une URL signée à durée limitée avec permission revérifiée (`apps/evidence/views.py`) — jamais un lien public direct — ce qui couvre une partie de l'exigence de confidentialité, mais pas le filtrage à l'entrée. |
| Limitation des tentatives de connexion | 🔴 | Vérifié dans `config/settings.py` : aucune classe de throttling DRF configurée. |
| Révocation de session avant expiration naturelle | 🔴 | `SIMPLE_JWT` ne configure ni blacklist ni rotation de refresh token — un jeton compromis reste valable jusqu'à ses 7 jours. |
| Sauvegarde/restauration testée | ⚪ | Sujet infrastructure, hors code applicatif — non auditable depuis le dépôt seul. |

## Ce qui est déjà solide (aucun besoin d'y retoucher)

RLS multi-tenant stricte, chaîne Visible Trust complète et testée, verrouillage du
devis, mise en concurrence sans fuite de montants aux candidats (invariant 25.18),
barème sectoriel du bureau de contrôle, prospect→client (`ProgramRequest`). C'est le
socle "Production + Contrôle indépendant" du Triangle de Confiance du CDC — déjà
mature. **C'est le pilier "Finance-Confiance" qui manque presque entièrement**, ce qui
recoupe exactement le constat déjà posé par `docs/gate3-classement-angles-morts.md`
(item 1 : paiements et flux financiers réels, classé RESEARCH REQUIRED → MUST probable).

## Correspondance avec les 20 tests d'acceptation du CDC (§12.1)

Indicatif seulement — aucun de ces tests n'a été exécuté contre le CDC (ils n'existent
pas encore dans la suite de tests de ce projet). Statut déduit de l'architecture
actuelle.

| Test | Objet | Statut aujourd'hui |
|---|---|---|
| T01 | Concurrence sur une même réservation | 🔴 Aucun mécanisme de réservation |
| T02 | Expiration d'un blocage impayé | 🔴 Idem |
| T03 | Frais puis complément → RESERVED/COMMITTED | 🔴 Idem |
| T04 | Contrat signé non modifiable | 🔴 Aucun contrat |
| T05 | Constructeur ne peut accepter ses propres travaux | 🟢 Déjà garanti (`IsInspecteur`) |
| T06 | Réserve → correction → recontrôle | 🟢 Déjà couvert (ticket 009) |
| T07 | Pièce remplacée après acceptation bloque le décaissement suivant | 🟡 La partie "nouvelle revue nécessaire" est plausible, la partie "décaissement bloqué" ne peut pas être vraie — l'objet n'existe pas |
| T08 | Cloisonnement RLS entre dossiers clients | 🟢 Déjà éprouvé (RLS + `LotClient`) |
| T09 | Décaissement refusé si réserve ouverte / solde insuffisant | 🔴 Aucun objet décaissement |
| T10 | Idempotence, concurrence sur un même disponible | 🔴 Idem |
| T11 | Rapprochement sans confirmation bénéficiaire | 🔴 Aucun flux financier |
| T12 | Versement partiel/excédentaire | 🔴 Idem |
| T13 | Marquage démo sur écrans/exports | 🔴 Aucune notion de démo |
| T14 | Réinitialisation + archive d'instance | 🔴 Idem |
| T15 | Rejet d'un dépôt de fichier interdit/trop volumineux | 🔴 Confirmé absent |
| T16 | Modification/suppression d'événement refusée | 🟡 Vrai pour `TrustEvent` seul, pas pour un futur journal général |
| T17 | Sauvegarde/restauration isolée | ⚪ Hors code applicatif |
| T18 | Changement de version de Country Pack sans casser l'historique | 🟡 Le mécanisme de versionnement existe (`MilestoneTemplate`, `LegalPaymentTierTemplate`) mais n'a jamais été exercé en situation réelle multi-instance |
| T19 | Parcours complet par un non-technicien, sans intervention en base | 🔴 Cette session elle-même en est la preuve : chaque scénario de démonstration a nécessité une intervention Django shell (pas d'API d'écriture sur `LotClient`/réservation) |
| T20 | Usage mobile et navigation clavier | 🟡 Travail de responsive déjà fait (ticket F-050) mais jamais audité écran par écran pour ce niveau d'exigence |

**Score honnête aujourd'hui : 3 verts, 5 jaunes, 11 rouges, 1 hors-code — sur 20.**

## Plan proposé, en 4 phases

Ordre choisi pour suivre la logique du CDC lui-même (§13) : cadrage d'abord, puis les
briques dans l'ordre de dépendance réelle (une finance simulée a besoin d'un contrat,
un contrat a besoin d'une réservation).

### Phase 0 — Cadrage (aucun code)

Faire trancher par le Product Owner les points A07-A17 encore ouverts dans le CDC — en
particulier A06 (règles ADV sensibles, explicitement hors périmètre) et A11 (source de
vérité). Rien ne se code avant que le périmètre exact soit confirmé — c'est ce que dit
la §13.4 du CDC lui-même, pas une prudence ajoutée ici.

### Phase 1 — Séparation des rôles + sécurité de base

Rapide, peu risquée, corrige déjà deux vrais trous de sécurité indépendamment du reste :

- Rôle `gestionnaire_adv` distinct d'`admin_keyimmo`.
- Rôle `finance` distinct (lecture/écriture sur les flux simulés uniquement, jamais sur
  les avis techniques — même invariant que le CDC pour le bureau de contrôle).
- Validation de type/taille de fichier à l'upload (PDF/JPEG/PNG, 10 Mo).
- Throttling DRF sur `/api/auth/login/`.
- Couvre T15 entièrement, prépare T05-équivalent pour les nouveaux rôles.

### Phase 2 — Réservation et contrat

- `Reservation` avec machine à états réelle (`REQUESTED→HELD→RESERVED→COMMITTED/
  EXPIRED/CANCELLED`), verrou atomique anti-concurrence (transaction + contrainte DB,
  même discipline que le reste du projet — voir `LotLedger`/`_get_or_create_task` pour
  le pattern déjà établi).
- `ContractVersion` versionné, jamais écrasé (même doctrine append-only que
  `TrustEvent`).
- Remplace `Lot.commercial_status`/`LotClient` (aujourd'hui sans API d'écriture) par un
  vrai cycle de vie.
- Couvre T01-T04, T19 (au moins pour cette partie du parcours).

### Phase 3 — Finance simulée (le vrai cœur manquant)

- `PaymentSchedule`/`PaymentCall` généré depuis `ContractVersion` +
  `LegalPaymentTierTemplate` (enfin connecté à quelque chose de réel).
- Seed du barème légal réel — Sénégal et/ou Côte d'Ivoire selon la décision A02.
- `CustomerReceipt`/`Allocation` — encaissement simulé, affectation aux appels, partiel
  géré explicitement.
- `Disbursement` — demande liée au jalon `TECHNICALLY_ACCEPTED` sans réserve ouverte,
  éligibilité vérifiée, verrouillage de solde anti-double-dépense.
- Couvre T09-T12.

### Phase 4 — Démonstration, indicateurs, réception

- `DemoInstance` (marquage `DEMO`/`simulation:true`, archivage, rejouabilité).
- Écran indicateurs (§9.3 du CDC).
- Les 20 tests T01-T20 comme suite d'acceptation formelle du projet.
- Couvre T13-T14, T17-T18, T20.

## Prochaines étapes

Ce document n'engage aucun travail. Avant toute Phase 1 :

1. Confirmer que la lecture ci-dessus du CDC est correcte (aucun malentendu sur un
   point précis).
2. Trancher la Phase 0 (A06, A11 au minimum).
3. Décider si l'on démarre par la Phase 1 (rapide, sécurité) pendant que la Phase 0 se
   discute en parallèle, ou si tout attend la Phase 0.
