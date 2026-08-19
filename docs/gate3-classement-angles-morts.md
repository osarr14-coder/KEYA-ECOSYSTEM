# Gate 3 — Projet de classement des angles morts (complément V4.0)

> **⚠️ CECI EST UNE PROPOSITION, PAS UNE DÉCISION FINALE.** Ce document est un projet
> de classement à valider avec Assane Sarr avant toute action. Aucun de ces
> classements n'engage de travail tant qu'il n'a pas été confirmé, ajusté ou rejeté.

## Contexte

Sur les 10 angles morts identifiés au complément V4.0 (section 1), 2 sont déjà
traités par le ticket 011 (`011-messagerie-backoffice-minimal.md` — messagerie tracée
et back-office minimal) et donc absents de ce classement. Les 8 restants, encore sans
statut, sont classés ci-dessous selon MUST / SHOULD / LATER / RESEARCH REQUIRED.

Grille de lecture utilisée (implicite, à discuter si elle ne convient pas) :
- **MUST** : bloque un vrai pilote avec de vrais utilisateurs / du vrai argent.
- **SHOULD** : pas bloquant pour un pilote restreint et maîtrisé, mais nécessaire
  avant toute ouverture plus large.
- **LATER** : pertinent mais pas urgent au vu de l'usage/marché actuel du pilote.
- **RESEARCH REQUIRED** : le cadre (légal, réglementaire, ou simplement l'existence
  d'une infrastructure externe à intégrer) n'est pas encore assez connu pour classer
  l'item lui-même — un travail de clarification doit précéder le classement définitif.

## Classement proposé

### 1. Paiements et flux financiers réels (séquestre, commission, etc.)

**Proposition : RESEARCH REQUIRED**, avec statut cible probable MUST une fois le
cadre validé — mais **ce n'est pas un sujet vierge**, voir précision ci-dessous.

Justification : aucun module de paiement n'existe dans le code actuel
(`INSTALLED_APPS` ne contient aucune app paiement/finance). En revanche, côté
KEYA CRM, `docs/QUESTIONS_D11_MODELE_JURIDIQUE_SEQUESTRE.md` (écrit le 2026-08-14)
montre qu'un travail de cadrage a déjà eu lieu.

**Modèle conçu ≠ modèle validé — distinction volontaire, à ne pas gommer** :
- **Conçu** (fait, côté interne KEYA) : flux de décaissement précis en 3 étapes
  (BC valide → KEYA valide 5 contrôles → la banque paie l'entreprise ET la
  commission KEYA en une opération → KEYA paie ensuite le BC sur sa propre
  commission) ; KEYA jamais dépositaire direct des fonds clients ; banque
  traditionnelle retenue plutôt qu'un établissement de paiement/EMI ; short-list de
  4 banques sénégalaises (Ecobank, Société Générale, CBAO/Attijariwafa, La Banque
  Agricole) ; 29 questions juridiques déjà rédigées et organisées en 7 sections
  (qualification du compte séquestre, pouvoir de signature, responsabilités en cas
  de litige, gel/dégel, conformité BCEAO/UMOA, aspects pratiques).
- **Validé (pas fait, ne pas présenter comme acquis)** : **faux tant que l'avocat
  OHADA/UMOA et les 4 banques n'ont pas répondu.** Aucun contact réel n'a eu lieu
  avec ces banques ; aucune des 29 questions n'a de réponse d'un juriste ou d'un
  interlocuteur bancaire réel. `KEYA_DECISIONS_LOG.md` (Décision D011) qualifie ce
  point de « BLOQUANTE avant tout pilote réel » précisément pour cette raison — un
  modèle conçu en interne n'a aucune valeur juridique tant qu'il n'est pas confirmé
  par un tiers qualifié.

RESEARCH REQUIRED reste le bon classement — mais la recherche à mener est
**l'envoi des 29 questions à un avocat et aux 4 banques candidates, pas une
réflexion à démarrer de zéro.** Prochaine étape concrète : sections A–F à un
avocat droit bancaire OHADA/UMOA, section G directement aux 4 banques.

### 2. Contrats et signature électronique

**Proposition : SHOULD**

Justification : nécessaire avant une ouverture large (une transaction immobilière
réelle se conclut par un contrat signé), mais moins bloquant que les paiements —
des solutions de signature électronique tierces existent et sont intégrables sans
devoir résoudre un flou juridique préalable comparable à celui du séquestre. Peut
suivre le paiement plutôt que le précéder.

### 3. KYC / AML et conformité identité

**Proposition : LATER**, dépendant de l'item 1.

Justification : le besoin de KYC/AML est directement conditionné par l'existence
d'un flux financier réel (item 1) — sans paiement, l'exigence réglementaire
KYC/AML ne s'applique pas encore avec la même force. Prématuré de le classer
indépendamment avant que l'item 1 ne soit lui-même clarifié.

### 4. Support client et résolution de litiges

**Proposition : SHOULD**

Justification : le ticket 011 a été motivé explicitement par la préservation de la
chaîne de preuve (éviter les échanges hors plateforme) — une fois des litiges réels
attendus avec de vrais utilisateurs, l'absence de circuit de résolution formel
devient visible rapidement. Pas bloquant pour un pilote restreint avec peu
d'utilisateurs connus, mais nécessaire avant toute ouverture plus large.

### 5. Protection des données personnelles (par pays, Country Pack)

**Un seul angle mort, deux classements distincts selon le pays — à ne pas fusionner
en une seule ligne.**

**5a. Sénégal — Proposition : MUST avant tout pilote réel.**

Justification : le MVP1 collecte déjà des données personnelles réelles (identité,
documents bancaires classés confidentiels, preuves photographiques) — ce n'est pas
un risque futur mais un fait déjà présent dans le système. Une revue de conformité
minimale à la loi sénégalaise 2008-12 (protection des données à caractère
personnel, autorité CDP) est nécessaire **avant** d'ouvrir la plateforme à de vrais
utilisateurs — contrairement à l'item 1 (paiements), rien ici n'attend une
validation bancaire externe : c'est une revue de conformité peut-être plus rapide
à mener, mais elle bloque le pilote réel sénégalais tout autant.

**5b. Extension future (Côte d'Ivoire, Guinée) — Proposition : RESEARCH REQUIRED.**

Justification : l'ambition multi-pays du projet (voir
`UTB_CDC_V2_Senegal_Cote_Ivoire.docx`) implique des cadres légaux distincts par
pays, pas encore établis pour la Côte d'Ivoire ni la Guinée. Contrairement au
Sénégal (5a), il n'y a pas encore de pilote réel prévu dans ces pays — le travail
de cadrage légal peut donc suivre plutôt que précéder, sans bloquer quoi que ce
soit dans l'immédiat.

### 6. Stratégie de connectivité réseau faible (hors CONTROL, déjà couvert)

**Proposition : LATER**

Justification : CONTROL (usage terrain par l'inspecteur) a déjà son mécanisme
offline dédié (tickets 010, 015, 018). HOME (client) et BUILD (constructeur,
back-office production) sont des usages plus sédentaires/bureau, où la
connectivité faible est un risque moindre à ce stade du pilote. À reconsidérer si
le profil d'usage réel montre le contraire.

### 7. Modération et qualité des données (documents falsifiés, doublons)

**Proposition : SHOULD**

Justification : touche directement à la doctrine « Visible Trust » qui est la
promesse centrale du produit — un document falsifié ou un doublon non détecté
sape cette promesse à la racine. Pas strictement bloquant pour un pilote restreint
avec des utilisateurs connus et de confiance, mais devient nécessaire dès qu'on
ouvre à des utilisateurs moins connus.

### 8. Interopérabilité cadastre / registres officiels

**Proposition : RESEARCH REQUIRED**

Justification (reprise et confirmée) : à la connaissance actuelle, aucun cadastre
numérique national n'existe encore à intégrer au Sénégal — il n'y a donc rien de
concret à connecter aujourd'hui. Déjà noté à l'origine comme « item de veille ».
À vérifier périodiquement plutôt que planifier maintenant.

## Synthèse

| # | Item | Proposition |
|---|------|-------------|
| 1 | Paiements et flux financiers réels | RESEARCH REQUIRED — modèle **conçu** (flux 3 étapes, KEYA jamais dépositaire, short-list 4 banques, 29 questions rédigées), modèle **validé** faux tant que l'avocat OHADA/UMOA et les 4 banques n'ont pas répondu. Prochaine étape = envoi des 29 questions, pas repartir de zéro. → MUST probable |
| 2 | Contrats et signature électronique | SHOULD |
| 3 | KYC / AML | LATER (dépend de #1) |
| 4 | Support client et litiges | SHOULD |
| 5a | Protection des données — Sénégal | MUST avant tout pilote réel (loi 2008-12/CDP, données déjà collectées au MVP1) |
| 5b | Protection des données — extension Côte d'Ivoire, Guinée | RESEARCH REQUIRED (cadre légal pas encore établi, pas de pilote prévu dans l'immédiat) |
| 6 | Connectivité réseau faible (hors CONTROL) | LATER |
| 7 | Modération et qualité des données | SHOULD |
| 8 | Interopérabilité cadastre | RESEARCH REQUIRED |

> Rappel : proposition à valider, pas une décision. Merci de confirmer, corriger ou
> rejeter chaque ligne avant qu'elle ne serve de base à un ticket ou une roadmap.
