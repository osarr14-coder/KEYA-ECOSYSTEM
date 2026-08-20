# Questions juridiques complémentaires — session modèle économique
### À fusionner avec QUESTIONS_D11_MODELE_JURIDIQUE_SEQUESTRE.md (29 questions existantes)

Ce document compile toutes les nouvelles questions juridiques soulevées au fil de la conception du modèle économique et du chantier de configuration (tickets 022 à B-035). Chacune est reliée à la décision produit qui l'a fait émerger, pour que l'avocat comprenne le contexte sans avoir à relire toute la conversation.

---

## 1. Cadre VEFA — garantie financière d'achèvement et séquestre

**Contexte** : le modèle de paiement repose sur un appel de fonds par jalon, libéré directement par la banque (jamais par KEYIMMO), sur le modèle légal identifié (Loi n°2009-23, paliers 35/70/95/5).

**Question** : le cadre VEFA sénégalais impose-t-il déjà une garantie financière d'achèvement (GFA) ou un compte séquestre réglementé, comme c'est le cas en droit français (obligatoire depuis 2015) ? Si oui, quel rôle KEYIMMO peut-elle jouer dans ce dispositif sans jamais devenir elle-même dépositaire des fonds ?

## 2. Versements progressifs à l'intérieur d'un palier légal

**Contexte** : pour des raisons opérationnelles (contact plus fréquent avec le client, appels de fonds moins lourds, gestion plus facile d'un défaut de paiement), KEYIMMO souhaite pouvoir séquencer chaque grand palier légal (35/70/95/5) en plusieurs appels de fonds plus petits.

**Question** : la loi sénégalaise autorise-t-elle des versements progressifs à l'intérieur d'un même palier (plusieurs petits appels de fonds cumulant vers le plafond légal), ou exige-t-elle un versement unique au franchissement exact de chaque palier ?

## 3. Risque de requalification en promoteur de fait

**Contexte** : le modèle retenu applique une marge sur le coût de revient de l'écosystème (foncier + construction + bureau d'études + bureau de contrôle + frais de séquestre), de l'ordre de 18% de la valeur totale — comparable à la marge d'un promoteur traditionnel, alors que KEYIMMO ne porte explicitement ni le risque de construction ni la détention de fonds.

**Question** : cette structure de marge expose-t-elle KEYIMMO à un risque de requalification en promoteur immobilier de fait au sens de la Loi n°2009-23, avec les obligations afférentes (garantie financière d'achèvement, garanties légales décennale/biennale) ? Quelle structuration contractuelle permettrait de sécuriser le positionnement d'orchestrateur tout en captant cette marge ?

## 4. Désistement client et mécanisme de pénalité/revente symétrique

**Contexte** : en cas de désistement d'un client en VEFA suivi d'une revente du bien, le modèle retenu prévoit une pénalité contractuelle de recouvrement (taux configurable par pays, à définir), avec un mécanisme symétrique : KEYIMMO/le sponsor conservent l'intégralité de la plus-value en cas de revente favorable, mais absorbent aussi l'intégralité de la moins-value en cas de revente défavorable — le client ne recevant jamais moins que ses cotisations moins la pénalité, ni n'étant jamais appelé à combler un manque.

**Question** : ce mécanisme de pénalité contractuelle et de partage symétrique de la plus/moins-value est-il conforme au droit sénégalais du contrat de réservation VEFA ? Existe-t-il un plafond légal impératif (par exemple sur le montant maximal de la pénalité retenue) auquel cette clause devrait se conformer ?

## 5. Contrat de réservation distinct de l'acte de vente authentique

**Contexte** : le processus commercial (module ADV) distingue désormais explicitement une étape de réservation (avec dépôt de garantie) d'une étape ultérieure d'acte de vente authentique chez le notaire — deux moments juridiques différents, initialement confondus dans la première ébauche du processus.

**Question** : le droit sénégalais de la VEFA prévoit-il formellement un contrat de réservation distinct de l'acte de vente authentique ? Ce contrat de réservation comporte-t-il un dépôt de garantie plafonné et un délai de rétractation légal (sur le modèle du droit français, à ne pas supposer identique) ? Quels sont les montants et délais exacts applicables ?

## 6. Régime légal de la copropriété

**Contexte** : le module ADV a identifié un processus continu de copropriété (syndic provisoire assumé par le sponsor ou son mandataire, puis assemblée générale constitutive, puis syndic élu), ainsi qu'un acteur potentiellement absent de l'écosystème produit (le syndic de copropriété).

**Question** : quel est le régime légal sénégalais applicable à la copropriété — formalités de désignation et de durée du syndic provisoire, délai et modalités de l'assemblée générale constitutive, obligations spécifiques du sponsor pendant la phase de syndic provisoire ?

---

## Récapitulatif — statut de ces 6 questions

| # | Sujet | Urgence relative |
|---|---|---|
| 1 | GFA / séquestre VEFA | Haute — conditionne tout le modèle de paiement |
| 2 | Versements progressifs par palier | Haute — conditionne l'implémentation technique déjà en cours (LegalPaymentTierTemplate) |
| 3 | Requalification promoteur de fait | Haute — conditionne la légitimité même du taux de marge retenu |
| 4 | Désistement / pénalité symétrique | Moyenne — mécanisme non encore implémenté techniquement |
| 5 | Contrat de réservation VEFA | Moyenne — module ADV encore classé LATER, non prioritaire au développement |
| 6 | Régime copropriété | Basse — décision produit (dixième acteur ou non) encore non tranchée, LATER |

*Document généré à l'issue de la session de conception du modèle économique. À transmettre à l'avocat OHADA/UMOA en complément des 29 questions déjà rédigées.*
