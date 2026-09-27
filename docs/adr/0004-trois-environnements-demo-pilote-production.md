# ADR 0004 — Trois environnements : DÉMO, PILOTE, PRODUCTION

## Statut

**Acceptée sur le principe par le Product Owner le 27 septembre 2026**
(journal des décisions, PO-2026-09-27-15). Les modalités marquées « à valider » ci-dessous
restent soumises au PO, et, pour les points juridiques, à un conseil habilité. Aucun
environnement PILOTE ni PRODUCTION n'est créé par cet ADR : il fixe la cible et les
conditions d'ouverture.

## Contexte

Le Product Owner a posé la question : « Pourquoi développer constamment une démo alors
qu'on peut faire la solution en vrai, la tester et isoler les données de test ? »

Constat :

1. **Le code n'est pas une maquette.** Le CDC R1 §3 le prévoit : « mécanismes réels sur
   données fictives ». Permissions serveur, isolation par organisation (RLS PostgreSQL),
   machines à états (réservation, contrat, jalon, réserve), journal append-only et
   contrôles de concurrence sont ceux du produit. Les corrections de l'audit UI R1
   (R02, K01–K03, D01…) sont du travail produit, conservé tel quel.
2. **Seuls trois éléments sont « démo »**, et ils le sont pour des raisons de
   responsabilité, non techniques :

   | Élément simulé | Condition pour le rendre réel |
   |---|---|
   | Flux financiers (compte du programme, encaissements, décaissements) | Banque partenaire et montage juridique du compte du programme (arbitrage A05 ouvert). |
   | Actes (signature du contrat, contrôle d'identité) | Prestataire de signature électronique reconnu ; contrats et Country Pack validés juridiquement (A06, A09). |
   | Données personnelles des clients | Conformité à la loi ivoirienne n° 2013-450 sur les données à caractère personnel et formalités auprès de l'ARTCI ; CGU et politique de confidentialité validées. |

3. **Isoler les données de test** est la bonne pratique, à condition de le faire par
   **environnement** (base, secrets, adresse et sauvegardes distincts), et pas seulement
   par un attribut dans une base partagée. Mêler données réelles et données de test dans
   une même base expose à des statistiques contaminées, à un déclenchement par erreur
   d'un acte réel et à une fuite de données personnelles. L'identifiant d'instance
   (`DemoInstance`, audit D01) isole des sessions de démonstration **à l'intérieur** de
   l'environnement DÉMO ; il ne remplace pas un environnement séparé.
4. **La force de l'écosystème réside dans ses partenaires** (PO-2026-09-27-13) :
   constructeurs, bureaux de contrôle, artisans (PO-2026-09-27-14). Leur recrutement et
   leur qualification n'ont pas besoin de flux financiers réels ; ils peuvent commencer
   avant la banque partenaire.

## Décision

Le même code est déployé dans trois environnements, strictement séparés.

| | **DÉMO** | **PILOTE** | **PRODUCTION** (Projet 1) |
|---|---|---|---|
| Finalité | Présentation aux investisseurs, formation, recette des parcours | Onboarding réel des partenaires ; test du chantier et des contrôles sur un vrai projet | Exploitation commerciale |
| Données | Intégralement fictives (jeu versionné `DEMO-CI-v…`) | **Réelles pour les partenaires** (entreprises, contacts, références, pièces de qualification) ; aucun client acquéreur réel | Réelles |
| Argent | Simulé, marqué « SIMULÉ — SANS VALEUR OPÉRATIONNELLE » | **Aucun flux** : modules financiers désactivés | Réel, via la banque partenaire |
| Signature, identité | Simulées | Désactivées (aucun acte engageant) | Prestataires réels |
| Accès | Sur invitation, comptes de démonstration | Candidature des partenaires (parcours « Devenir partenaire ») + comptes créés par KEYIMMO | Selon CGU |
| Marquage à l'écran | « DÉMONSTRATION — DONNÉES FICTIVES » + instance | « PILOTE — aucun engagement financier » (libellé à valider) | Aucun bandeau de test |
| Base, fichiers, secrets | Propres | Propres | Propres |

### Règles

1. **Un environnement = une base, un stockage de fichiers, des secrets, une adresse et
   des sauvegardes.** Aucune donnée ne circule d'un environnement à l'autre. Pas de copie
   de la PRODUCTION vers la DÉMO ou le PILOTE.
2. **L'environnement est une configuration, pas un code.** Une variable unique
   (`KEYA_ENVIRONMENT = DEMO | PILOTE | PRODUCTION`) pilote : le bandeau, les en-têtes
   d'API (`X-Environment`), les modules activés (flux financiers, signature), les
   commandes de démonstration (réinitialisation, jeu initial) et les connecteurs.
   Aujourd'hui `apps/core/demo.py` fixe `ENVIRONMENT = 'DEMO'` en dur : à remplacer par
   cette variable quand le PILOTE sera ouvert.
3. **Garde-fous par environnement, vérifiés côté serveur :**
   - DÉMO : aucun connecteur réel activé ; réinitialisation autorisée.
   - PILOTE : modules financiers et signature refusés par le serveur (pas seulement
     masqués) ; réinitialisation et jeu de démonstration **interdits** ; formulaires
     réels avec mentions légales.
   - PRODUCTION : commandes de démonstration **interdites** ; aucun compte de
     démonstration ; bandeau absent.
4. **Passage d'un environnement à l'autre** : jamais par retrait d'un badge
   (CDC R1 §3.1). Chaque ouverture fait l'objet d'une validation dédiée (conditions
   ci-dessous) et d'une entrée au journal des décisions.
5. **Les développements restent communs.** Une fonctionnalité est construite une fois ;
   elle est activée, désactivée ou simulée selon l'environnement.

### Conditions d'ouverture

**PILOTE** (à valider par le PO et un conseil habilité) :

- hébergement distinct (service et base Render dédiés, ou équivalent), sauvegarde et
  exercice de restauration réussi ;
- CGU partenaires et politique de confidentialité ; formalités ARTCI pour les données
  des partenaires ;
- parcours « Devenir partenaire » réel (candidature → examen → activation → annuaire →
  affectation), distinct de la version démontrée en DÉMO ;
- programme pilote choisi et lancé par KEYIMMO AFRIC (PO-2026-09-27-13) ;
- modules financiers et signature désactivés côté serveur, avec tests.

**PRODUCTION** (Projet 1) :

- banque partenaire et montage du compte du programme (A05) ;
- contrats et Country Pack validés juridiquement (A06, A09) ; prestataire de signature ;
- conformité des données des clients ; assurance ;
- modalités de désignation et de rémunération du contrôleur (PO-2026-09-27-01, J03) ;
- revue de sécurité et recette complète T01–T20 sur l'environnement de production ou un
  environnement équivalent documenté.

## Conséquences

- La DÉMO reste utile et peu coûteuse : son marquage et ses simulations sont une couche
  mince au-dessus du produit réel.
- Le recrutement des partenaires peut démarrer en PILOTE sans attendre la banque.
- À faire avant l'ouverture du PILOTE : variable `KEYA_ENVIRONMENT` et ses garde-fous
  serveur, déploiement séparé, textes légaux. À planifier dans le lot « Écosystème
  partenaires ».
- Coût : un second (puis un troisième) ensemble de services d'hébergement.

## Options écartées

- **Une seule base avec un indicateur « test » par ligne** : risques de contamination
  des statistiques, d'acte réel déclenché par erreur et de fuite de données ; chaque
  requête devrait filtrer correctement, sans filet.
- **Passer directement en production avec de vrais clients** : engagement financier et
  juridique de KEYIMMO sans banque partenaire, sans contrat validé ni conformité des
  données.
- **Tout garder en démo jusqu'au Projet 1** : retarde le recrutement des partenaires,
  qui fait la force de l'écosystème.
