# Prompt Claude Code — Direction visuelle et design system KEYIMMO AFRIC (MVP investisseurs)

> À coller dans Claude Code, à la racine du dépôt. Le cahier des charges de référence est `KEYIMMO_AFRIC_CDC_V3_MVP_REVISION_R1.md` (à placer dans `docs/` s'il n'y est pas).

---

## Contexte

Tu travailles sur KEYIMMO AFRIC, une plateforme qui orchestre et trace la construction immobilière en Côte d'Ivoire autour d'un « Triangle de Confiance » : Production (constructeur), Contrôle indépendant (bureau de contrôle), Finance-Confiance. Le MVP est une **démonstration pour investisseurs, sur données entièrement fictives**. Lis d'abord le cahier des charges en entier, en particulier les sections 1, 3.1, 4, 6, 7, 8, 9 et 12.

Ta mission ici porte **uniquement sur la direction visuelle, le design system et la couche UI**. Tu ne tranches aucune décision produit ou technique ouverte (A05–A17) et tu ne fusionnes rien.

L'objectif : une interface qui inspire la même confiance qu'un outil bancaire ou un registre notarial, et qui ne ressemble **en rien** à une interface générée par IA. Un investisseur doit se dire « c'est sérieux, c'est rigoureux, c'est traçable ».

## Méthode imposée (dans cet ordre)

1. **Audit** — Inspecte le dépôt : stack front, librairie de composants, système de styles, conventions, `CLAUDE.md` et `docs/ai-factory/`. Adapte-toi à l'existant ; ne réécris rien et n'introduis pas de nouvelle stack sans le signaler. Si aucune stack front n'est choisie, propose-en une dans un ADR mais **ne l'installe pas** sans validation.
2. **Proposition** — Rédige `docs/design/DESIGN_SYSTEM.md` : direction, tokens, typographie, composants, vocabulaire des statuts, règles de marquage démo. Arrête-toi et demande-moi de valider avant l'étape 3.
3. **Tokens + galerie** — Implémente les tokens (variables CSS, et config Tailwind si Tailwind est présent) puis une page de galerie interne (`/design-system` ou Storybook si déjà présent) qui montre chaque composant dans tous ses états, sur données fictives.
4. **Écrans** — Seulement ensuite, applique le système aux écrans de la section 9.2, un par un.
5. **Vérification visuelle** — Pour chaque écran, prends des captures (Playwright) à **375 px** et **1440 px**, en clair, relis-les de façon critique contre les règles ci-dessous, corrige, recommence (au moins 2 passes). Joins les captures finales à ton compte rendu.

Travaille sur une branche dédiée. Pas de fusion, pas de déploiement.

## Direction artistique

**Registre : institutionnel, précis, calme.** Références d'esprit : un relevé bancaire privé bien composé, un registre foncier, Stripe Dashboard, Linear, Mercury. Pas une landing page de startup.

- Densité maîtrisée : beaucoup d'information, parfaitement alignée. Les données sont la vedette, pas la décoration.
- Hiérarchie par la typographie (taille, graisse, couleur du texte), pas par des cartes, ombres et encadrés empilés.
- Texte aligné à gauche. Grille stricte. Tableaux lisibles.
- Ancrage local discret : une teinte « latérite » en accent rare, en clin d'œil aux sols d'Abidjan. **Aucun** motif wax, kente, masque ou cliché « africain » décoratif.

### Couleurs (point de départ, à affiner dans la proposition)

| Rôle | Valeur | Usage |
|---|---|---|
| Fond | `#F7F5F0` (papier) | Fond d'application |
| Surface | `#FFFFFF` | Tableaux, panneaux |
| Encre | `#16202E` | Texte principal, actions primaires |
| Texte secondaire | `#5F6673` | Métadonnées, libellés |
| Bordure | `#E3DFD6` | Séparateurs 1 px |
| Accent latérite | `#A8472A` | Très rare : repère de marque, élément actif clé. Jamais pour un statut. |
| Succès | `#2E6A45` | |
| Attention | `#9A5B0B` | |
| Critique | `#A3262A` | |
| Information | `#23577F` | |

Contrastes WCAG AA minimum sur tout texte. **La couleur ne porte jamais seule une information** : toujours libellé + icône ou forme. Prévois un mode sombre dans les tokens mais ne le développe pas au-delà.

### Typographie

- Interface : **IBM Plex Sans** (400, 500, 600). Chiffres tabulaires (`font-variant-numeric: tabular-nums`) partout où il y a des montants, dates, compteurs.
- Titres de page et documents contractuels : **Source Serif 4** (600), avec parcimonie, pour l'effet « acte ».
- Références techniques (référence bancaire simulée, identifiants d'instance, numéros de version) : **IBM Plex Mono**.
- Échelle : 12 / 13 / 14 / 16 / 20 / 24 / 32 px. Corps d'UI en 14 px (16 px sur les vues mobiles client et chantier).

### Forme

- Espacements : multiples de 4 px.
- Rayons : 4 px (champs, boutons), 6 px (panneaux). Rien au-delà, pas de pilules géantes.
- Bordures 1 px plutôt qu'ombres. Une seule ombre légère autorisée, pour les menus et modales.
- Icônes : Lucide uniquement, 16 px (20 px mobile), trait 1.5.
- Animations : transitions de 120–180 ms sur les états d'interaction uniquement. Pas d'animation d'entrée décorative.

## Interdits absolus

- Dégradés (fond, texte, bouton, bordure).
- Violet, indigo, néon, glassmorphism, flou d'arrière-plan.
- Emojis dans l'interface.
- Hero centré avec titre géant, grilles « 3 features avec icône », témoignages, compteurs animés.
- Scores globaux, jauges de « confiance », étoiles, pourcentages de fiabilité : le cahier les **interdit** (§1).
- Illustrations 3D, images générées par IA, photos stock de personnes souriantes.
- Logos de banques ou partenaires réels, ou tout visuel suggérant un accord inexistant (§3).
- Icônes « étincelles » ou tout vocabulaire visuel évoquant l'IA : le produit n'en contient pas (A15).
- Textes marketing creux (« Révolutionnez… », « Boostez… »). Écris en français clair, factuel, métier.
- Tout état affiché comme accompli alors qu'il n'a pas eu lieu (§9.2).

Pour les visuels de biens : plans schématiques ou façades au trait, sobres, créés dans le projet, marqués fictifs. Pas de photos réalistes.

## Règles propres à ce produit (non négociables)

### 1. Marquage démonstration et simulation (§3.1)

C'est un élément de design de premier rang, pas une rustine. Il doit être **impossible à rater sur une capture d'écran**, tout en restant élégant.

- Bandeau permanent en haut de chaque écran : « DÉMONSTRATION — DONNÉES FICTIVES », avec l'identifiant d'instance en Plex Mono. Motif de hachures diagonales fines neutres pour le distinguer de tous les statuts (différencié par la **forme**, pas par une couleur de statut). Non masquable.
- Tout acte externe simulé (signature, contrôle d'identité, exécution bancaire, confirmation bénéficiaire) porte un marqueur « SIMULÉ — SANS VALEUR OPÉRATIONNELLE » accolé à l'élément concerné, dans la même grammaire visuelle hachurée.
- PDF et exports : filigrane diagonal + en-tête et pied de page avec le marquage et l'instance.
- Instance archivée : bandeau supplémentaire « ARCHIVE — LECTURE SEULE » et désactivation visible de toutes les actions.

### 2. États de travail ≠ niveaux de confiance (§7)

Deux grammaires visuelles **distinctes** :

- **États** (réservation, contrat, jalon, flux financiers, décaissement) : badges compacts, libellé + point de couleur.
- **Niveaux de confiance** (Déclaré → Documenté → Contrôlé → Vérifié → Validé) : une échelle en étapes, jamais un badge ni une jauge. Chaque niveau atteint affiche **qui, quand, sur quelle version, dans quel périmètre**. Un niveau non atteint reste visible et vide. « Validé techniquement — démonstration » précise toujours le contrôleur. Aucun cumul en score.

Libellés d'états à utiliser (identifiants techniques en anglais, affichage en français) :

| Objet | Affichage |
|---|---|
| Réservation | Demandée · Bien bloqué · Réservée · Concrétisée · Expirée · Annulée |
| Contrat | Brouillon · En revue · Approuvé · Signé (simulé) |
| Jalon | Brouillon · Soumis · En examen · Corrections demandées · Resoumis · Accepté techniquement |
| Décaissement (demande) | Brouillon · Éligible · Exécuté (simulé) · Annulé |
| Mouvement financier | Planifié · Exécuté par la banque (simulé) · Rapproché (simulé) · Confirmé par le bénéficiaire (simulé) |

Rassemble ces correspondances dans le glossaire du design system.

### 3. Montants, dates, références

- Montants en entiers XOF, espaces fines insécables comme séparateurs de milliers, alignés à droite dans les tableaux : `30 000 000 XOF`. Code devise toujours visible.
- Distinguer visuellement : attendu, encaissé, affecté, **non affecté** (jamais masqué), réservé, disponible.
- Dates au format `27 sept. 2026, 14:05` avec le fuseau affiché (`GMT, Abidjan`) dans les détails et l'historique.
- Références bancaires simulées et versions en Plex Mono, copiables.

### 4. Traçabilité visible

- Composant **chronologie** (historique d'audit) : liste verticale sobre, acteur + rôle, action, date serveur, justification, lien vers l'objet/version. Lecture seule, sans bouton d'édition.
- Composant **historique de versions** (contrats, pièces) : version courante en avant, versions antérieures consultables, jamais supprimées. Un avis reste visuellement attaché à la version examinée.
- Composant **réserve** : ouverte / levée, date, auteur, motif, action attendue, correction proposée, décision du contrôleur.
- Indicateurs (§9.3) : chaque chiffre est cliquable jusqu'à ses sources, avec numérateur/dénominateur visibles. Dénominateur nul → « Non applicable », jamais « 100 % ».

### 5. Deux espaces par rôle

- **Client et constructeur (mobile d'abord)** : 375 px, cibles tactiles de 44 px, une action principale par écran, lisible en plein soleil sur chantier (contraste élevé), formulaires courts.
  - Espace client : ton rassurant et factuel. La sortie de fonds vers le constructeur est présentée comme une sortie **du programme**, jamais comme une dette du client.
- **Gestionnaire, contrôleur, Finance, admin (desktop d'abord)** : tableaux denses, filtres, tri, panneau de détail latéral, raccourcis clavier discrets. Finance : vue de rapprochement de type relevé bancaire.

### 6. États et accessibilité (§9.2, T20)

Chaque écran et composant gère explicitement : chargement (squelettes sobres, pas de spinner plein écran), vide (phrase utile + prochaine action), erreur (compréhensible, sans fuite d'information), succès.

Actions interdites : bouton visible mais désactivé avec explication (« Seul le bureau de contrôle peut lever une réserve »), sans révéler de donnée confidentielle.

Navigation clavier complète, focus visible (anneau 2 px encre), libellés de formulaire explicites, pas de débordement horizontal à 375 px.

## Livrables attendus

1. `docs/design/DESIGN_SYSTEM.md` (direction, tokens, typo, composants, glossaire des statuts, règles de marquage) — **à me soumettre avant d'implémenter**.
2. Tokens implémentés et page de galerie des composants avec tous leurs états.
3. Écrans de la section 9.2, un par un, avec captures 375 px et 1440 px.
4. À chaque étape : une courte liste des écarts éventuels avec le cahier des charges ou avec ces règles, et les points à arbitrer par le Product Owner.

Avant de livrer chaque écran, pose-toi ces questions : un investisseur pourrait-il croire qu'une opération est réelle ? Une information critique repose-t-elle uniquement sur la couleur ? Ce composant ressemble-t-il à un template générique ? Si oui à l'une d'elles, corrige.
