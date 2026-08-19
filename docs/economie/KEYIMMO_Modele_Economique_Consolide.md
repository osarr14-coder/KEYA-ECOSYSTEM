# KEYIMMO AFRIC — Modèle économique consolidé
### Synthèse des arbitrages business — document de travail, à valider formellement avant intégration au complément V4.0

---

## 0. Principe directeur, non négociable

**KEYIMMO ne détient jamais de fonds destinés à un tiers.** Tout l'argent circule directement entre client, banque, et professionnels (constructeur, bureau d'études, bureau de contrôle, notaire). KEYIMMO facture et encaisse uniquement ce qui lui revient en propre, jamais un pot commun redistribué. Ce principe conditionne toute l'architecture ci-dessous et reste valable tant que le modèle de séquestre n'a pas été validé juridiquement (OHADA/UMOA, banques partenaires).

**KEYIMMO ne devient jamais promoteur.** Elle orchestre, documente, transmet, trace — elle ne porte jamais le risque de construction, ne garantit jamais un achèvement, ne décide jamais à la place d'un professionnel compétent (banque pour le crédit, notaire pour le juridique, bureau de contrôle pour la conformité technique).

---

## 1. Les deux canaux clients

### Canal 1 — Programme immobilier conçu par KEYIMMO / un sponsor
Foncier en partenariat, structuration VEFA, plusieurs lots vendus à plusieurs clients. Le sponsor/constructeur porte le programme ; KEYIMMO orchestre.

### Canal 2 — Construction suivie sur parcelle propre du client
Le client apporte sa propre parcelle, demande un accompagnement pour la faire construire. Le client est de facto le "sponsor" de son propre programme (un programme à un seul bien). Active immédiatement LAND (revue foncière) dès le premier jour.

**Les deux canaux ont des modèles de revenus structurellement différents** — ne jamais les fusionner (canal 1 = marge sur cession d'un bien que KEYIMMO structure ; canal 2 = pas de cession, le client construit sur son propre bien).

---

## 2. Acteurs de l'écosystème — mise à jour

Écosystème V3.0 (section 2) enrichi d'un nouvel acteur :

- Client / diaspora
- Constructeur
- Bureau de contrôle
- Artisan / PME (PRO)
- **Bureau d'études / ingénierie — nouvel acteur à part entière, distinct de PRO.** Intervient en amont (phase conception), avant tout premier coup de pioche. Son propre Professional Capability Passport, sa propre logique de mise en relation.
- Banque
- Notaire
- Institutions et partenaires

---

## 3. Cadre légal identifié (Sénégal) — à confirmer par l'avocat OHADA/UMOA

Recherche effectuée, à considérer comme point de départ, pas comme validation juridique :

- **Loi n° 2009-23** (Code de la Construction) définit la VEFA au Sénégal avec un **paiement échelonné plafonné** : 35% maximum à l'achèvement des fondations, 70% à la mise hors d'eau, 95% à l'achèvement, 5% à la livraison.
- **Loi n°2023-20** du 29 décembre 2023 modernise le cadre, renforce la sécurité dans les relations entre acteurs de la construction.
- Le régime français de Garantie Financière d'Achèvement (obligatoire depuis 2015, article L.261-1 CCH) **ne doit pas être supposé identique** au régime sénégalais — statut à vérifier spécifiquement.

**Ces plafonds (35/70/95/5) sont des contraintes légales dures**, pas des paramètres de conception — aucun appel de fonds ne peut dépasser le plafond cumulé de son palier, quelle que soit la granularité interne choisie par KEYIMMO.

---

## 4. Mécanisme de paiement — trois chemins pour le client, avec correction

| Chemin | Description | Statut |
|---|---|---|
| (a) Paiement intégral chez la banque | Rejeté tel qu'initialement proposé (rémunération liée à la durée du dépôt = incitation perverse, KEYIMMO gagnerait plus si le chantier ralentit). **Corrigé** : toute rémunération doit être liée à la validation d'un jalon, jamais à la durée d'immobilisation des fonds. |
| (b) **Appel de fonds via la plateforme, libéré directement chez la banque** | **Chemin recommandé en priorité.** KEYIMMO déclenche la notification d'appel de fonds sur `TrustEvent` "validé", l'argent circule uniquement entre client et banque. Réutilise directement la mécanique de confiance déjà éprouvée sur 5 passages de test bout-en-bout. |
| (c) Dossier de crédit documenté, transmis à la banque | Déjà couvert par la doctrine FINANCE existante (section 9), aucun changement nécessaire. |

---

## 5. Structure de paliers légaux configurable par pays — invariant technique proposé

**Ne pas se contenter de rendre les pourcentages configurables — la structure elle-même doit l'être.**

> *"La structure des paliers légaux de paiement (nombre de paliers, plafonds, jalons associés, règle de versement) vit entièrement dans le CountryPack, jamais codée en dur. Aucun appel de fonds ne peut être émis pour un programme dont le pays n'a pas de LegalPaymentTierTemplate validé juridiquement et activé explicitement."*

Cohérent avec le pattern déjà éprouvé et testé pour `MilestoneTemplate` (ticket 002) — même discipline, même type de garde de code source à prévoir.

**Question ouverte pour l'avocat** : la loi autorise-t-elle des versements progressifs à l'intérieur d'un même palier (plusieurs petits appels de fonds cumulant vers le plafond), ou exige-t-elle un versement unique au franchissement exact du palier ?

---

## 6. Modèle de revenus — Canal 1 (structuration retenue : marge sur coût de revient)

**Principe retenu** : KEYIMMO applique une marge sur le coût de revient de l'écosystème (foncier + construction + bureau d'études + bureau de contrôle + frais de séquestre/banque), affichée comme ligne de devis explicite, jamais noyée dans le prix de cession.

### Quatre corrections obligatoires à ce modèle, actées dans cette session

1. **Marge fixée contractuellement à la signature** (montant ou % ferme) — jamais calculée comme un résidu après coup. Sinon KEYIMMO absorbe silencieusement le risque de dépassement de coût du chantier, ce qui la rapproche d'un vrai promoteur sans que ce soit une décision assumée.
2. **Budget du bureau de contrôle sanctuarisé** — jamais soumis à l'arbitrage de marge de KEYIMMO, indexé sur un barème sectoriel standard. C'est l'acteur dont l'indépendance garantit tout le triangle de confiance ; aucune pression économique descendante ne doit s'y exercer.
3. **Marge KEYIMMO affichée comme ligne de devis distincte**, visible du client dès la création du devis — cohérence avec la promesse de transparence qui différencie KEYIMMO du modèle traditionnel opaque.
4. **Modèle réservé exclusivement au canal 1** — le canal 2 n'a pas de "cession", donc pas de coût de revient à marger de la même façon (voir section 7).

### Libération de la marge — même règle que pour tous les autres bénéficiaires

La marge KEYIMMO est **séquencée et libérée à l'issue de chaque jalon validé**, sur exactement le même `TrustEvent` "validé" (sans réserve ouverte) que celui qui déclenche le paiement des autres bénéficiaires (constructeur, BE, BC) — jamais un événement plus lâche ou plus rapide. Techniquement : instruction de paiement multi-bénéficiaires envoyée à la banque à chaque palier, chaque bénéficiaire (dont KEYIMMO) recevant sa part sur la même instruction, jamais KEYIMMO ne recevant un pot commun à redistribuer.

### Exemple chiffré (illustratif, hypothèses de marché posées explicitement, à corriger avec de vrais devis)

Programme de 500 logements économiques, foncier de ~5 hectares (hypothèse de densité ~100 logements/ha, à valider par un urbaniste), foncier à 1,5 md FCFA, prix de cession 30 000 000 FCFA/logement.

| Poste (par logement) | Montant |
|---|---|
| Foncier aménagé | 3 000 000 FCFA |
| Construction | 20 000 000 FCFA |
| Bureau d'études (~5% construction) | 1 000 000 FCFA |
| Bureau de contrôle (~1,5% construction) | 300 000 FCFA |
| Frais de séquestre/banque | 200 000 FCFA |
| **Coût de revient total** | **24 500 000 FCFA** |
| **Prix de cession** | **30 000 000 FCFA** |
| **Marge KEYIMMO disponible** | **5 500 000 FCFA (≈18,3%)** |

**Sur 500 logements : ≈2,75 milliards FCFA, soit ~18,3% de la valeur totale du programme** — de l'ordre de grandeur d'un promoteur traditionnel, très supérieur au modèle de frais fixes fragmentés initialement testé (~1,35%, jugé insuffisant pour couvrir la structure).

### Conséquence stratégique à assumer consciemment

À ce niveau de marge, **KEYIMMO ne peut plus se différencier par le prix** — un client ne paiera pas structurellement moins cher que via un promoteur classique. La différenciation doit reposer entièrement sur la transparence et la traçabilité (Visible Trust), pas sur un argument tarifaire.

---

## 6bis. Réconciliation entre devis verrouillé (estimation) et offre gagnante réelle

**Problème identifié** : le `Devis` (ticket 022) est verrouillé et immuable *avant* la mise en concurrence des constructeurs — au moment du verrouillage, la ligne "construction" n'est qu'une **estimation budgétaire**, jamais le coût réel. Le coût réel n'est connu qu'après sélection du gagnant de l'appel d'offres. Le modèle de marge fixée à la signature (invariant 25.15) doit être réconcilié avec cet écart temporel.

**Principe retenu** : le prix annoncé au client, basé sur le devis verrouillé, est un **plafond ferme, jamais dépassé**, quelle que soit l'issue réelle de l'appel d'offres.

| Situation | Traitement |
|---|---|
| Offre gagnante **moins chère** que l'estimation | L'écart favorable reste **intégralement acquis à KEYIMMO** comme marge complémentaire — contrepartie symétrique du risque qu'elle accepte de porter dans le sens inverse (même logique que le mécanisme de désistement, 14bis) |
| Offre gagnante **plus chère** que l'estimation, dans la limite de la marge disponible | La **marge de KEYIMMO absorbe l'écart**, jamais répercuté sur le client — la marge peut descendre jusqu'à zéro, jamais en dessous |
| Offre gagnante **plus chère** que l'estimation, au-delà de ce que la marge peut absorber (même à marge nulle, le prix client ne serait pas respecté) | **Aucune sélection automatique** — le dossier retourne en re-négociation explicite avec le client (nouvel appel d'offres ou révision du devis avec son accord), jamais une perte silencieusement absorbée par KEYIMMO ni un dépassement imposé au client |

**Implication technique** : le `Devis` original reste immuable (cohérent avec le ticket 022). Toute réconciliation post-appel d'offres doit créer un **nouvel événement d'ajustement** (`DevisAjustement` ou équivalent) référençant le devis original, jamais une modification du devis lui-même — même principe que la correction d'une réserve, qui crée un nouvel événement plutôt que d'écraser l'original (ticket 005).

---

## 7. Modèle de revenus — Canal 2 (frais de dossier + commission séparée)

Le modèle de marge sur coût de revient ne s'applique pas ici (pas de cession). Modèle retenu :

| Source | Payeur | Nature |
|---|---|---|
| Frais de dossier | Client | Revue professionnelle du foncier (jamais "validation" — distinction stricte avec la validation notariale finale, cf. section 8) + plans/devis du bureau d'études |
| Commission plateforme, variable par pays et type de construction | Client | Ligne séparée du devis, jamais mêlée aux honoraires professionnels |
| Frais par appel de fonds validé | Client, via banque | Chemin (b), section 4 |
| Frais de mise en relation / succès | Constructeur, bureau d'études (choisis par le client, jamais par la banque) | Payé par le professionnel depuis son propre revenu, jamais prélevé sur l'argent du client en transit |
| Frais forfaitaire / API | Notaire, Banque | Cohérent avec le modèle déjà esquissé en V4.0 |

**Rappel de doctrine appliqué ici** : la sélection du constructeur revient au **client**, jamais à la banque — la banque décide uniquement du financement (9.2), pas du choix de l'entreprise.

---

## 8. Distinction stricte : revue professionnelle du foncier ≠ validation notariale

Deux étapes différentes, à ne jamais fusionner dans le produit :

- **En amont (LAND, section 11)** : un professionnel (potentiellement un notaire, agissant alors comme réviseur) réalise une **revue professionnelle** du foncier. Niveau Visible Trust : "vérifié", jamais "validé par autorité".
- **En aval (NOTARY, section 10)** : la vraie validation juridique arrive au moment du Notary Ready Package. *"READY FOR NOTARIAL REVIEW ne signifie jamais validation juridique."*

Facturer les deux comme un honoraire unique et indifférencié percuterait l'invariant 25.5 ("pas de validation juridique attribuée à KEYIMMO").

---

## 9. Verrouillage du devis et mise en concurrence des constructeurs

### Mécanisme retenu

1. Le devis complet (BE, BC, construction, marge KEYIMMO) est **verrouillé et horodaté** (mécanisme `TrustEvent`, append-only — même pattern que celui qui protège déjà l'historique de contrôle) **avant** la sélection du constructeur. Empêche toute modification a posteriori favorisant un constructeur par connivence.
2. Le devis complet est **visible du client dès sa création** — transparence totale de ce côté.
3. **Les constructeurs candidats ne voient que le périmètre technique et les exigences de qualité — jamais les montants précis budgétés.** Publier les montants aux candidats produirait un effet d'ancrage (les offres s'alignent vers le plafond affiché plutôt que de réellement se concurrencer à la baisse).
4. Le budget du bureau de contrôle reste sanctuarisé (section 6), jamais mis en concurrence, connu du client mais hors appel d'offres constructeur.

---

## 10. Risque juridique majeur à faire trancher en priorité

**Une marge de l'ordre de 18% sur coût de revient, comparable à celle d'un promoteur, expose à un risque de requalification en "promoteur de fait"** au sens de la Loi n°2009-23, avec les obligations afférentes (garantie financière d'achèvement, garanties légales décennale/biennale) que KEYIMMO n'a explicitement pas vocation à porter.

**Nouvelle question à ajouter à la liste des 29** : *"KEYIMMO, en captant une marge structurée sur le coût de revient de chaque bien et libérée par jalon, risque-t-elle une requalification en promoteur immobilier de fait ? Quelle structuration contractuelle permettrait de sécuriser le positionnement d'orchestrateur tout en captant cette marge ?"*

---

## 11. Leviers de revenus transverses (les deux canaux, secondaires)

| Source | Nature |
|---|---|
| Écart de négociation groupée (matériaux, plans standardisés) | Marge captée par pouvoir d'achat/volume, sans jamais porter le risque de construction |
| Service de coordination premium | Prestation de main-d'œuvre optionnelle, facturée comme un vrai service |
| Licence de données agrégées | Institutions/partenaires, vue de marché anonymisée (déjà esquissé en V4.0 2.1) |

---

## 12. Ce qui existe déjà techniquement vs ce qui reste à construire

| Brique nécessaire | État |
|---|---|
| Verrouillage immuable d'un document avant un événement métier | Le pattern `TrustEvent` existe et est éprouvé — réutilisable directement |
| `LegalPaymentTierTemplate` (paliers légaux par `CountryPack`) | Conçu dans cette session, jamais codé |
| Entité "Devis" avec ses lignes (BE, BC, constructeur, marge KEYIMMO) | N'existe pas |
| Workflow de mise en concurrence / sélection de constructeur | N'existe pas (le plus proche en esprit, `InspectionMission` du ticket 012, ne couvre qu'une affectation admin, pas un appel d'offres) |
| Instruction de paiement multi-bénéficiaires vers la banque | N'existe pas — cœur de FINANCE, dépend de la validation juridique du séquestre |
| Sanctuarisation du budget bureau de contrôle | Concept nouveau à modéliser |

**Point important** : tout, sauf l'instruction de paiement réel vers la banque, est de la documentation et de l'orchestration — ça ne dépend pas de la validation juridique du séquestre et peut être construit dès maintenant.

---

## 13. Questions ajoutées à la liste des 29 (modèle juridique séquestre) durant cette session

1. Le cadre VEFA sénégalais impose-t-il déjà une garantie financière d'achèvement ou un compte séquestre réglementé, et quel rôle KEYIMMO peut-il jouer sans devenir lui-même dépositaire ?
2. Le paiement échelonné VEFA (35/70/95/5) autorise-t-il des versements progressifs à l'intérieur d'un même palier, ou exige-t-il un versement unique au franchissement exact du palier ?
3. KEYIMMO, en captant une marge structurée sur le coût de revient et libérée par jalon, risque-t-elle une requalification en promoteur immobilier de fait ? Quelle structuration contractuelle sécurise le positionnement d'orchestrateur ?

---

## 14bis. Désistement client et revente en VEFA — mécanisme symétrique retenu

**Rejeté initialement** : capter automatiquement l'écart entre l'ancien et le nouveau prix de vente comme source de marge systématique, sans justification ni symétrie de risque.

**Mécanisme retenu, version affinée** : une pénalité contractuelle de recouvrement (taux configurable par pays, jamais codé en dur — cf. 14ter), couvrant les frais réels engagés par KEYIMMO pour purger le litige (jours-homme de recouvrement, transmission de courriers, honoraires du conseil). Le traitement diffère selon l'issue de la revente, de façon symétrique :

| Scénario de revente | Client récupère | KEYIMMO / sponsor conserve |
|---|---|---|
| Revente au même prix | Cotisations versées − pénalité | La pénalité (frais réels couverts) |
| Revente à prix supérieur | Cotisations versées − pénalité (jamais plus) | La pénalité + l'intégralité de la plus-value |
| Revente à prix inférieur | Cotisations versées − pénalité (jamais appelé à combler la différence) | La pénalité seulement — la perte de marché est absorbée par KEYIMMO/sponsor, jamais répercutée sur le client défaillant |

**Justification de la symétrie** : KEYIMMO/le sponsor ne peut légitimement conserver la plus-value d'une revente favorable que s'il accepte aussi d'absorber la moins-value d'une revente défavorable — sans cette réciprocité, le mécanisme devient une clause structurellement déséquilibrée, probablement qualifiable d'abusive. Cette symétrie est ce qui rend le modèle défendable.

**Nouvelle question ajoutée à la liste juridique** : la pénalité contractuelle de recouvrement (taux à définir, configurable par pays) et le mécanisme symétrique de partage de la plus/moins-value de revente sont-ils conformes au droit sénégalais du contrat de réservation VEFA, ou existe-t-il un plafond légal impératif auquel cette clause doit se conformer ?

---

## 14ter. Interface d'administration des tarifs et marges

Extension directe de l'invariant 25.14 : les taux de marge (canal 1) et de commission (canal 2) doivent vivre dans une configuration versionnée par `CountryPack`, jamais codés en dur, avec historique auditable de tout changement (qui, quand, ancien taux, nouveau taux). Buildable dès maintenant, sans dépendance à la validation juridique du séquestre — bon candidat pour un prochain ticket d'extension du back-office (ticket 021 déjà livré).

---

## 14quater. Module ADV (Administration Des Ventes) — nouvelle expérience candidate, non bloquante

**Constat** : aucune expérience existante (HOME, BUILD, CONTROL, PRO, FINANCE, NOTARY, LAND, PASSPORT) ne couvre le cycle de vie administratif de la relation commerciale client — distinct de NOTARY (dossier juridique pour l'étude notariale) et de FINANCE (exposition bancaire).

**Principe de conception non négociable** : ce processus varie potentiellement par pays (délais de rétractation, existence ou non d'un contrat de réservation distinct, régime de copropriété, formalités de titre foncier). Il doit suivre exactement le même principe que les jalons (`MilestoneTemplate`) et les paliers légaux (`LegalPaymentTierTemplate`, 14/25.14) : **la séquence d'étapes elle-même — pas seulement ses délais ou montants — vit dans le `CountryPack`, jamais codée en dur.** Aucune étape du processus ADV ne doit être supposée universelle avant validation pays par pays.

### Processus corrigé, après confrontation aux pratiques du métier

Le processus initialement proposé (qualification → réservation → compromis → avances → recouvrement → finalisation → attestations → titres/copropriété) a été challengé et corrigé sur plusieurs points :

| Étape | Correction apportée par rapport à la proposition initiale |
|---|---|
| 1. Qualification prospect | Ajout d'une évaluation de capacité de financement (simulation, pré-accord bancaire), pas seulement une qualification commerciale — sans elle, on réserve des lots à des clients qui échoueront à financer, alimentant directement le mécanisme de désistement (14bis) |
| 2. Réservation | Reformulée comme **contrat de réservation distinct**, avec dépôt de garantie plafonné et délai de rétractation légal — pas un "compromis" (terminologie inadaptée à la VEFA, où compromis désigne généralement un bien déjà achevé) |
| 3. Acte de vente VEFA authentique | **Étape distincte de la réservation**, chez le notaire — démarre le calendrier légal de paiement échelonné (35/70/95/5, section 3). Fusionnée à tort avec la réservation dans la proposition initiale |
| 4. Appels de fonds par jalon | Distingué du dépôt de garantie de réservation — deux flux financiers différents, à des moments différents, avec des règles de remboursement différentes ; ne pas les traiter comme une "gestion des avances" continue et indifférenciée |
| 5. Relance / recouvrement | Étape manquante dans la proposition initiale : mise en demeure progressive en cas de retard, avant tout déclenchement du mécanisme de désistement/pénalité (14bis) |
| 6. Finalisation financière | 100% du prix payé → déclenche l'attestation de fin de paiement (fait financier constaté, jamais présentée comme validation juridique de transfert — invariant 25.5) |
| 7. Finalisation juridique | **Événement séparé de la finalisation financière**, jamais automatique du seul fait du paiement complet — transfert de propriété, acte authentique, titre individualisé, compétence exclusive du notaire |
| 8. Réception / livraison | Réutilise telle quelle la doctrine déjà posée en 14.2 de la V3.0 |
| 9. Titres fonciers | Ne pas créer un nouveau statut ADV — réutilise la doctrine LAND déjà posée (11.2) |
| 10. Copropriété | Nouveau processus continu identifié : syndic provisoire → assemblée générale constitutive → syndic élu |
| 11. Garanties post-livraison | Connexion à assurer avec le domaine Warranties déjà identifié dans l'architecture (4.3) |
| 12. Attestation de versement partiel | Retenue, avec garde-fou : mention explicite qu'elle ne constitue ni une garantie de livraison ni un titre de propriété |
| 13. Cession du contrat avant achèvement | Étape manquante dans la proposition initiale, distincte du désistement pour défaut de paiement (14bis) |

### Acteur manquant identifié — décision à trancher

**Le syndic de copropriété n'existe dans aucun écosystème actuel.** Décision à prendre : dixième acteur à part entière, ou hors périmètre produit pour l'instant.

### Nouvelles questions ajoutées à la liste juridique

1. Le droit sénégalais de la VEFA prévoit-il un contrat de réservation distinct de l'acte de vente authentique, avec un dépôt de garantie plafonné et un délai de rétractation légal ? Montants et délais exacts ?
2. Quel est le régime légal sénégalais applicable à la copropriété (syndic provisoire, formalités de l'assemblée générale constitutive, obligations du sponsor pendant la phase de syndic provisoire) ?

**Classement proposé** : LATER — neuvième expérience candidate, non prioritaire, à revisiter avec compléments dès que les questions juridiques auront des réponses, pays par pays avant toute activation.

---

## 14. Invariants proposés, à intégrer formellement à la doctrine

- **25.14** — La structure des paliers légaux de paiement vit entièrement dans le `CountryPack`, jamais codée en dur. Aucun appel de fonds n'est émis pour un pays sans `LegalPaymentTierTemplate` validé juridiquement et activé.
- **25.15** — La marge KEYIMMO sur un bien est fixée contractuellement à la signature, jamais calculée comme un résidu après coût réel constaté.
- **25.16** — Le budget du bureau de contrôle est sanctuarisé, indexé sur un barème sectoriel, jamais soumis à l'arbitrage de marge de KEYIMMO ni à une négociation.
- **25.17** — La marge KEYIMMO est libérée sur le même `TrustEvent` "validé" que celui déclenchant le paiement des autres bénéficiaires d'un même palier, jamais anticipée ni différée.
- **25.18** — Les montants budgétaires détaillés d'un devis ne sont jamais communiqués aux constructeurs candidats lors d'une mise en concurrence — seuls le périmètre technique et les exigences de qualité le sont.

---

*Document de travail issu des échanges de session. À faire valider formellement avant intégration au complément V4.0 et rédaction du scope technique (ticket 022).*
