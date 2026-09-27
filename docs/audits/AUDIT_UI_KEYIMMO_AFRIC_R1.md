# KEYIMMO AFRIC — Audit UI et conformité du MVP démo

| Champ | Valeur |
|---|---|
| Date | 27 septembre 2026 |
| Référentiel | `KEYIMMO_AFRIC_CDC_V3_MVP_REVISION_R1.md` (cité « CDC ») + prompt de design `prompt_design_keyimmo_claude_code.md` |
| Méthode | Revue de 14 captures d'écran fournies par le Product Owner (desktop 1440 px et mobile 390 px). Aucun accès au code, à l'API ni à la base. |
| Écrans couverts | Landing, création de compte, espace client (Mon acquisition), back-office Contrôles à affecter, Finance Comptes & décaissements, Finance Virements déclarés, application Contrôle mobile (liste, terminées, fiche mission). |
| Non couverts | Espace constructeur, fiche bien détaillée, contrat, pilotage/indicateurs, administration/archivage, exports PDF, états chargement/erreur. |

**Limite de l'audit.** Les constats viennent de captures, pas d'un test. Ceux marqués « À vérifier » peuvent venir de données de test résiduelles plutôt que d'un défaut de conception. Ils doivent être confirmés dans le code ou par un test T01–T20 avant correction.

---

## 1. Synthèse

**Points forts à conserver**

- Identité visuelle cohérente entre les espaces (bleu nuit, doré, titres à empattements). Elle est récupérable : une refonte complète n'est pas nécessaire.
- Montants au format `30 000 000 XOF` avec code devise.
- Finance sépare déjà encaissements rapprochés, sorties exécutées, montant réservé et disponible (§8.2).
- Des états vides existent (« Aucun décaissement », « Aucune déclaration en attente »).
- Mention « (client fictif) » sur l'identité client.

**Problèmes bloquants avant présentation aux investisseurs**

1. La landing et les textes affirment un dispositif juridique et bancaire qui n'existe pas encore (séquestre, garanties, protection, indépendance acquise).
2. Une inscription publique collecte nom et e-mail, sans avertissement de données fictives, alors que l'accès doit être sur invitation.
3. Les données semblent mélanger plusieurs instances ou jeux de test : programmes en double, lot à la fois réservé et proposé à la réservation, missions en double.
4. Le marquage démo est absent de plusieurs espaces (client, back-office, application Contrôle).
5. L'application Contrôle ne montre pas les pièces du constructeur. Ses réserves ne sont pas structurées et sont levées implicitement.
6. Un compte back-office cumule administration, ventes, finance et chantier, ce que le §4 interdit.

---

## 2. Constats détaillés

Priorités : **P0** bloquant pour la démo · **P1** conformité CDC / cohérence métier · **P2** qualité visuelle (« look IA »), finitions.

### 2.1 Promesses et vocabulaire juridique

| ID | Prio | Écran | Constat | Réf. CDC | Correction attendue |
|---|---|---|---|---|---|
| J01 | P0 | Landing | « compte séquestre du programme » : terme juridique désignant un dispositif bancaire réel. | A05 ouvert, §1, §3 | « compte du programme (simulé) ». Aucun terme « séquestre » dans l'application. |
| J02 | P0 | Landing, pied de page | « vos versements sont protégés », « Immobilier neuf sécurisé », menu « Garanties ». | §1, §12.2 | Supprimer « protégés », « sécurisé », « garanties ». Menu « Comment ça marche ». Décrire le mécanisme, pas une protection. |
| J03 | P0 | Landing, back-office Contrôles | « Un bureau de contrôle indépendant, missionné par KEYIMMO » : indépendance présentée comme acquise ; « missionné par KEYIMMO » affaiblit l'argument. | §1, §9.1 | Formuler au futur ou au conditionnel, sans nommer qui missionne. **Arbitrage PO requis** sur qui missionne et rémunère le contrôleur. |
| J04 | P0 | Landing | « un prix figé à la réservation » : engagement commercial. | A06 ouvert | Retirer, ou « prix fictif de démonstration ». |
| J05 | P1 | Landing | Registre commercial en service (« Achetez votre logement… ») alors que le site est une démonstration. | §1, §3.1 | Titre et sous-titre décrivant ce que la plateforme démontre. Bandeau démo nettement visible (voir M01). |
| J06 | P1 | Back-office | Menu « Paliers légaux » : suggère une conformité légale. | A09, §3 | « Paliers — Country Pack CI (démo, non validé juridiquement) », version affichée. |
| J07 | P1 | Client, back-office | Verbe « valider » attribué à KEYIMMO (« Validation KEYIMMO », « Valide votre dossier »). | §1, §7.2 | Remplacer par l'action réelle : « Examen du dossier », « Prépare votre contrat ». |

### 2.2 Marquage démonstration et simulation

| ID | Prio | Écran | Constat | Réf. CDC | Correction attendue |
|---|---|---|---|---|---|
| M01 | P0 | Tous | Bandeau démo présent seulement sur les pages publiques, en ~11 px doré sur bleu nuit, peu visible. | §3.1 | Bandeau permanent sur **tous** les écrans, y compris espaces connectés et mobile : « DÉMONSTRATION — DONNÉES FICTIVES » + identifiant d'instance. Grammaire hachurée du prompt de design. |
| M02 | P0 | Espace client, Contrôles, app Contrôle | Aucun bandeau démo. | §3.1, T13 | Idem M01. |
| M03 | P1 | Client, Finance | Libellés hétérogènes : « Simulation — aucun fonds réel », « SIMULÉ — AUCUN FONDS RÉEL ». | §3.1 | Libellé unique : « SIMULÉ — SANS VALEUR OPÉRATIONNELLE », accolé à chaque acte simulé (signature, virement, rapprochement, décaissement). |
| M04 | P1 | Client, Finance | Le marqueur simulation est doré, comme la marque, et se lit comme décoratif. | Prompt design §1 | Style dédié (hachures, texte encre), distinct de la marque et des statuts. |
| M05 | P0 | App Contrôle, onglet navigateur | Nom « KEYA » / « KEYA CONTROL » et titre d'onglet « KEYA — Connexion ». | A01 | « KEYIMMO AFRIC » partout dans l'UI (le dépôt n'a pas à être renommé). |

### 2.3 Accès, comptes et rôles

| ID | Prio | Écran | Constat | Réf. CDC | Correction attendue |
|---|---|---|---|---|---|
| R01 | P0 | Créer mon espace, landing | Inscription publique, formulaire « Nom complet / Email » sans mention de données fictives. | §10 (invitation, pas d'identité réelle) | Supprimer l'inscription publique. Accès par comptes de démonstration provisionnés. Si un formulaire subsiste : mention explicite « n'indiquez aucune donnée réelle ». |
| R02 | P0 | Back-office | Un même compte voit Ventes, Finance, Chantier, Programmes et Administration. | §4 (fonctions incompatibles sur comptes distincts ; l'admin ne s'attribue pas de pouvoirs métier) | Un compte par rôle. Menu limité aux droits du rôle, droits appliqués côté serveur. |
| R03 | P1 — À vérifier | Finance | Le compte Finance voit aussi « Dossiers clients ». | §4 | Vérifier le rôle du compte ; séparer Gestionnaire et Finance si ce sont deux fonctions. |
| R04 | P1 | Back-office | « Devis / Appels d'offres », « Demandes de programme », « Tarifs » : modules hors périmètre (marketplace différée). | §3 Différé, §11 | Masquer du MVP ou faire approuver par le PO. |

### 2.4 Données et isolation des instances

| ID | Prio | Écran | Constat | Réf. CDC | Correction attendue |
|---|---|---|---|---|---|
| D01 | P0 — À vérifier | Finance | Deux « Résidence Démonstration Abidjan » (disponibles 0 et 2 100 000 XOF) et un « Programme B-047 » absent du scénario. | §3.1, §9.1, T14 | Une seule instance active visible. Filtrer par `demoInstanceId`. Purger les données de test. Afficher l'identifiant d'instance. |
| D02 | P0 — À vérifier | Client, Finance | Lot A2 réservé par Yao Kouassi (Finance) mais proposé « Réserver ce bien » dans l'espace client ; la landing affiche « 1 lot disponible ». | §6.1, T01 | Disponibilité dérivée de la réservation active bloquante. Lancer T01. |
| D03 | P1 — À vérifier | App Contrôle | Deux missions strictement identiques « Lot A2 — Fondations — Première inspection ». | §7.1 | Identifiant de mission, date, version examinée. Cause probable : D01. |
| D04 | P1 | Finance | « Afficher tous les jalons (8) » alors que le scénario en prévoit 2 par bien. | §9.1 | Conséquence probable de D01. |

### 2.5 Parcours client et états

| ID | Prio | Écran | Constat | Réf. CDC | Correction attendue |
|---|---|---|---|---|---|
| C01 | P1 | Client | Étape 4 « Signature du contrat · en cours » alors que le contrat est « en cours de préparation par le gestionnaire ». | §6.2, §9.2 | L'étape reflète l'état réel : « Préparation du contrat » (DRAFT/REVIEW), puis « Signature (simulée) » à APPROVED. |
| C02 | P1 | Client | « Votre prochaine action : Préparation de votre contrat » : ce n'est pas une action du client. | §9.2 | « Aucune action de votre part pour le moment » + ce qui va se passer ensuite. |
| C03 | P1 | Client | Étapes « Frais de réservation » puis « Premier versement » séparées : laisse croire que les frais s'ajoutent. | §9.1, T03 | Étape « Premier versement : 100 000 / 3 000 000 XOF — reste 2 900 000 XOF (frais inclus) ». |
| C04 | P1 | Client | Barre de suivi 100 000 / 30 000 000 XOF, presque vide. | §9.2 | Repère principal : premier versement (3 000 000). Prix total en information secondaire. |
| C05 | P1 | Client | « Validation KEYIMMO » : étape absente du parcours §6.1. | §6.1 | Retirer, ou faire arbitrer par le PO. |
| C06 | P1 | Client | « Paliers de travaux — selon l'avancement du chantier » : les appels suivent le calendrier contractuel, pas tous les jalons. | §8.1 | Afficher le calendrier contractuel fictif (dates, montants). |
| C07 | P1 | Client | « Réglé » : ne distingue pas déclaré et rapproché. | §8.1 | « Encaissé et rapproché (simulé) ». |
| C08 | P2 | Client | L'action principale n'est pas visible sans défiler. | Prompt design §5 | Bloc « Prochaine étape » juste sous l'en-tête. |

### 2.6 Finance

| ID | Prio | Écran | Constat | Réf. CDC | Correction attendue |
|---|---|---|---|---|---|
| F01 | P1 | Virements déclarés | Statut « Confirmé par Finance » : pas un état du CDC, et « confirmé » évoque la confirmation bénéficiaire. | §8.3 | « Rapproché (simulé) » (RECONCILED_SIM). |
| F02 | P1 | Virements déclarés | Pas de justificatif bancaire fictif, pas de référence bancaire simulée distincte de la référence client, pas d'affectation visible. | §8.1, T12 | Afficher justificatif, référence bancaire simulée (Plex Mono), affectation(s) aux appels, montant non affecté. |
| F03 | P1 | Comptes | Les montants ne sont pas décomposables jusqu'à leurs sources. | §1, §9.3 | Chaque montant clique vers la liste des mouvements qui le composent. |
| F04 | P2 | Comptes | Programmes choisis via de grosses pastilles-boutons qui passent sur deux lignes. | Prompt design | Sélecteur ou liste compacte. Devient trivial après D01. |
| F05 | P2 | Comptes | « Réservé : 0 XOF » mis en avant (bordure et chiffre dorés) sans raison. | Prompt design | Mise en avant uniquement si valeur non nulle ou anomalie. |
| F06 | P1 | Virements déclarés | Dates mixtes « 2026-09-27 » et « 27 septembre 2026 à 11:48 », sans fuseau. | §5 | Un seul format : `27 sept. 2026, 11:48 (GMT, Abidjan)`. |

### 2.7 Application Contrôle (mobile)

| ID | Prio | Écran | Constat | Réf. CDC | Correction attendue |
|---|---|---|---|---|---|
| K01 | P0 | Fiche mission | Le contrôleur ne voit ni la déclaration du constructeur ni les pièces soumises, ni leur version. Il remplit une checklist générique. | §7.1, §7.2 (avis lié aux versions examinées) | Section « Pièces soumises » en tête : fichiers, version, déposant, date. L'avis enregistre les versions examinées. |
| K02 | P0 | Fiche mission | « Réserve » = bouton radio + commentaire libre, placé avant la décision. | §7.1 | Réserve structurée : motif, action attendue, date serveur. Plusieurs réserves possibles. Commentaire après la décision. |
| K03 | P0 | Fiche mission | « Un avis conforme sur une mission de suivi lève la réserve » : levée implicite. | §7.1 (le contrôleur lève **chaque** réserve) | Décision explicite par réserve : Levée / Maintenue, avec motif. |
| K04 | P1 | Fiche mission | Mode hors ligne (« En attente de synchronisation », envoi différé). | §9.2 (hors connexion différé), §5 (date serveur) | Retirer du MVP ou faire arbitrer. Si conservé : afficher date de saisie **et** date serveur. |
| K05 | P1 | Terminées | « Avis rendu » sans le résultat (conforme ou réserve). | §7.2 | Afficher le résultat et le nombre de réserves ouvertes/levées. |
| K06 | P2 | Liste | Missions sans date ni identifiant, indiscernables. | §7.1 | Date de soumission, n° de version, identifiant court. |
| K07 | P2 | Fiche mission | Lien retour « ← Missions » minuscule. | T20 | Cible tactile ≥ 44 px. |

### 2.8 Qualité visuelle : ce qui fait « design IA »

| ID | Prio | Constat | Correction attendue |
|---|---|---|---|
| V01 | P2 | Sur-titre doré en majuscules espacées sur presque chaque bloc (« ESPACE ACQUÉREUR », « CHANTIER », « VENTES · FINANCE », « CHECKLIST »…). Marqueur typique des interfaces générées. | Supprimer. Un fil d'Ariane discret suffit dans le back-office. |
| V02 | P2 | Landing : titre + deux boutons + carte translucide à trois arguments avec icône. | Mise en page éditoriale sans carte « features » ni effet translucide. |
| V03 | P2 | Rangées de cartes KPI à gros chiffre à empattements, y compris à 0 (Contrôles, Finance, Virements). | Chiffres dans une ligne de synthèse ou en tête de tableau. Masquer ou griser les compteurs nuls. |
| V04 | P2 | Cartes empilées dans des cartes, rayons ~16–24 px. | Rayons 4–6 px, séparateurs 1 px, sections plutôt que cartes. |
| V05 | P2 | Liseré doré à gauche des cartes, en-tête mobile « flottant » arrondi avec ombre. | En-tête pleine largeur, cartes sans liseré décoratif. |
| V06 | P2 | Doré utilisé pour marque, sur-titres, navigation active, liserés, statut « en cours », marqueur simulation, boutons. | Doré réservé à la marque et à l'action primaire. Statuts avec leurs propres couleurs. |
| V07 | P2 | Même icône immeuble générique pour tous les biens et en « hero ». | Plan ou façade au trait propre au projet, marqué fictif, ou pas de visuel. |
| V08 | P2 | Icônes de menu réutilisées pour des sens différents (portefeuille pour Virements, Lots, Comptes, Tarifs ; bouclier pour Contrôles et Utilisateurs). | Une icône par concept. |
| V09 | P2 | Pastilles arrondies (« pilules ») pour statuts et badges. | Badge compact rayon 4 px, point de couleur + libellé. |
| V10 | P2 | Cloche « 0 » affichée en permanence. | Compteur visible seulement s'il y a des notifications. |
| V11 | P2 | Formulaire de connexion/inscription en carte centrée, bouton doré pleine largeur : gabarit générique. | Formulaire aligné à gauche, sobre, sans carte. |
| V12 | P2 | Textes descriptifs en bleu alors que ce ne sont pas des liens. | Bleu réservé aux liens. |

### 2.9 Finitions

| ID | Prio | Constat | Correction attendue |
|---|---|---|---|
| X01 | P2 | Surfaces « 82 m² » et « 75.00 m² ». | Format français sans décimales inutiles : `75 m²`. |
| X02 | P2 | « 2 lot(s) au total ». | Accord réel : « 2 lots ». |
| X03 | P2 | « Réservation du 27 septembre » isolé sous une carte, sans année ni heure. | Date complète dans l'en-tête du dossier. |
| X04 | P2 | Gris clair des étapes « À venir » probablement sous le contraste AA. | Vérifier et corriger à ≥ 4,5:1. |
| X05 | P2 | Barre latérale lourde pour deux entrées dans l'espace client. | Barre supérieure simple, mobile d'abord. |

---

## 3. Arbitrages à demander au Product Owner

1. **Qui missionne et rémunère le bureau de contrôle** (J03) et comment le formuler dans la démo.
2. **Étape « Validation KEYIMMO »** (C05) : à supprimer ou à intégrer au parcours §6.1.
3. **Modules hors périmètre** (R04) : Devis/Appels d'offres, Demandes de programme, Tarifs.
4. **Mode hors ligne de l'application Contrôle** (K04) : différé selon le CDC.
5. **Déclaration de virement par le client** (F01–F02) : flux non prévu au §8.1, à confirmer.

---

## 4. Instructions pour Claude Code

> À coller dans Claude Code avec ce fichier d'audit, le CDC R1 et le prompt de design dans `docs/`.

```
Lis docs/AUDIT_UI_KEYIMMO_AFRIC_R1.md, le cahier des charges R1 et
docs/prompt_design_keyimmo_claude_code.md.

Travaille sur une branche dédiée `fix/audit-ui-r1`. Aucune fusion, aucun déploiement.
Ne tranche aucun point de la section 3 de l'audit : laisse l'existant en place,
signale-le et passe à la suite.

Étape 0 — Vérification
Pour chaque constat marqué « À vérifier » (D01–D04, R03), confirme ou infirme
dans le code et les données. Indique la cause (données de test, défaut de
filtrage par demoInstanceId, autre). N'efface aucune donnée sans me demander.

Étape 1 — P0, dans cet ordre
J01–J04, M01, M02, M05, R01, R02, D01, D02, K01, K02, K03.
- Textes : ne rédige aucune nouvelle promesse. Décris le mécanisme démontré,
  au futur ou avec « (simulé) ».
- Rôles : droits appliqués côté serveur, pas seulement masquage du menu.
- Relie chaque correction aux tests T01–T20 concernés (notamment T01, T05, T06,
  T08, T13, T14) et ajoute ou complète les tests automatisés correspondants.

Étape 2 — P1
Tous les constats P1 hors arbitrages PO.
Utilise les libellés d'états du prompt de design (section « États de travail ≠
niveaux de confiance »).

Étape 3 — P2
Applique le design system du prompt de design. S'il n'existe pas encore,
rédige d'abord docs/design/DESIGN_SYSTEM.md et arrête-toi pour validation.

Pour chaque étape :
- Captures Playwright avant/après à 375 px et 1440 px de chaque écran modifié.
- Compte rendu : ID du constat, fichiers modifiés, test lié, résultat
  (CORRIGÉ / NON CORRIGÉ + raison / BLOQUÉ PAR ARBITRAGE).
- Un constat non testé est NOT_TESTED, pas corrigé.
Arrête-toi à la fin de chaque étape pour ma relecture.
```
