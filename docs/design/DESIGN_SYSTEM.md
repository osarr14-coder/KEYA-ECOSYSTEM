# KEYIMMO AFRIC — Design system (MVP de démonstration)

| Champ | Valeur |
|---|---|
| Statut | **Validé par le Product Owner le 27 septembre 2026 (PO-2026-09-27-20)**, propositions A-DS-1 à A-DS-6 retenues. |
| Date | 27 septembre 2026 |
| Sources | `docs/prompt_design_keyimmo_claude_code.md` (cité « prompt ») ; `docs/cdc/KEYIMMO_AFRIC_CDC_V3_MVP_REVISION_R1.md` (« CDC ») ; `docs/audits/AUDIT_UI_KEYIMMO_AFRIC_R1.md` (constats V01–V12, X01–X05) ; `docs/decisions/JOURNAL_DECISIONS.md`. |
| Décision cadre | **PO-2026-09-27-11** : pas de nouvelle refonte ; identité actuelle conservée (bleu nuit, doré, titres à empattements) ; règles du prompt appliquées, **sa palette remplacée par les couleurs actuelles** ; doré réservé à la marque et à l'action principale. |
| Code | `packages/design-system` (tokens, composants, formats), consommé par `apps/web`, `apps/home`, `apps/build`, `apps/control-pwa`. |

Ce document fixe la cible. Chaque écart entre l'existant et la cible est listé en §13, et chaque point que ce document ne peut pas trancher seul est en §14.

---

## 1. Audit de l'existant (méthode, point 1)

| Sujet | Constat | Conséquence |
|---|---|---|
| Stack front | React 18 + Vite + TypeScript, monorepo npm (`apps/*`, `packages/design-system`). Tests Vitest + Testing Library. | Aucune nouvelle stack. |
| Styles | Styles **inline** React + variables CSS `--keya-*` injectées par `GlobalStyles` (clair, sombre, `data-theme`). Pas de Tailwind, pas de CSS-in-JS, pas de Storybook. | Les tokens restent des variables CSS exposées par `semanticColors` ; la galerie sera une page interne, pas Storybook. |
| Composants existants | `AppShell`, `PageHeader`, `Card`, `KeyFigure`, `Pill`, `StatusBadge`, `Stepper`, `ProgressBar`, `Button`, `Input`, `Select`, `Field`, `AlertBanner`, `ApiErrorBanner`, `TabBar`, `Icon`, `DemoBanner`, `SimulatedMark`, formats de date. | Base réutilisée ; formes révisées (§5), composants de traçabilité ajoutés (§10). |
| Polices | Manrope (interface), Fraunces (titres), chargées depuis Google Fonts. Aucune police à chasse fixe chargée : les références utilisent la pile système. | Voir §4 et arbitrage A-DS-1. |
| Icônes | 17 tracés dessinés à la main (`Icon/paths.ts`), trait 1,75, style « outline », aucune dépendance. | Voir §5.4 et arbitrage A-DS-2. |
| Gouvernance | Tests `brandGovernance.test.ts` et `demoMarkingGovernance.test.ts` vérifient déjà l'usage de la marque et du marquage démo. | Étendus aux nouvelles règles (§12). |

## 2. Direction

**Registre : institutionnel, précis, calme** — un relevé bancaire privé, un registre foncier, pas une landing page. La confiance vient de la rigueur visible : chaque montant aligné, chaque date datée et fuseautée, chaque état nommé, chaque acte simulé marqué comme tel.

- **Les données sont la vedette.** Hiérarchie par la typographie (taille, graisse, couleur du texte), pas par des cartes et des ombres empilées (V03, V04).
- **Texte aligné à gauche, grille stricte, tableaux lisibles.** Un seul titre de page par écran.
- **Bleu nuit = structure et encre forte ; doré = marque et action principale, rien d'autre** (PO-11, V06). Le doré remplace l'accent « latérite » du prompt : il est aussi rare que lui.
- **Aucun cliché décoratif** : ni motif wax, kente ou masque, ni visuel IA, ni photo stock. Les biens sont montrés par les plans et façades au trait du projet, marqués fictifs (V07).

## 3. Couleurs

### 3.1 Correspondance avec les rôles du prompt

Les valeurs sont celles de `GlobalStyles.tsx` (thème clair). Seul le rôle **Information** est nouveau : il n'existe pas aujourd'hui et reprend la valeur du prompt.

| Rôle (prompt) | Token | Clair | Sombre | Usage |
|---|---|---|---|---|
| Fond | `--keya-neutral-background` | `#F7F3EA` | `#0A1628` | Fond d'application. |
| Surface | `--keya-neutral-surface` | `#FFFFFF` | `#13233F` | Tableaux, panneaux. |
| Surface discrète | `--keya-neutral-subtle` | `#F4F1EA` | `#1A2C4B` | En-têtes de tableau, justificatifs. |
| Encre | `--keya-neutral-text` | `#16202E` | `#F3F1EC` | Texte courant. |
| Encre forte (bleu nuit) | `--keya-neutral-heading` | `#0B1D3A` | `#F3F1EC` | Titres, action primaire sombre, bandeau démo. |
| Texte secondaire | `--keya-neutral-text-muted` | `#5B6472` | `#AEB9CB` | Métadonnées, libellés. |
| Bordure | `--keya-neutral-border` | `#E4DCCB` | `#4A5F82` | Séparateurs 1 px. |
| Marque et action principale (doré) | `--keya-accent-solid` | `#C49A2C` | `#C49A2C` | Logo, bouton d'action principale (texte bleu nuit dessus). **Jamais** un statut, un sur-titre, une bordure décorative, un marqueur. |
| Texte doré | `--keya-accent-text` | `#8A6A12` | `#E2C47A` | Uniquement le libellé de l'élément de navigation actif. |
| Succès | `--keya-success-text` / `-background` | `#1E5E42` / `#E3F2EA` | `#8FD9B6` / `#12352A` | États accomplis. |
| Attention | `--keya-alert-text` / `-background` / `-border` | `#92400E` / `#FFFBEB` / `#D97706` | `#FCD34D` / `#451A03` / `#F59E0B` | En attente d'une action, anomalie non bloquante. |
| Critique | `--keya-danger-text` / `-background` / `-border` | `#7F1D1D` / `#FEF2F2` / `#B91C1C` | `#FCA5A5` / `#450A0A` / `#F87171` | Refus, blocage, réserve ouverte. |
| **Information (nouveau)** | `--keya-info-text` / `-background` | `#23577F` / `#E8F0F6` | `#9CC3E4` / `#10263D` | États en cours sans action attendue (« En examen », « En revue »). |
| Progression | `--keya-progress-fill` / `-track` | `#2F7D5B` / `#EDE5D2` | `#4CB88A` / `#2A3B58` | Barres de couverture d'un montant (jamais de confiance). |

### 3.2 Contrastes (WCAG AA, calculés)

| Paire | Ratio | Verdict |
|---|---|---|
| Encre `#16202E` sur fond `#F7F3EA` | 14,81 | AA |
| Texte secondaire `#5B6472` sur fond / surface / surface discrète | 5,40 / 5,98 / 5,30 | AA |
| Blanc sur bleu nuit `#0B1D3A` | 16,79 | AA |
| Bleu nuit sur doré `#C49A2C` (bouton principal) | 6,40 | AA |
| Texte doré `#8A6A12` sur surface / fond | 5,06 / 4,57 | AA |
| Succès, attention, critique (texte sur leur fond) | 6,64 / 6,84 / 9,16 | AA |
| Information `#23577F` sur `#E8F0F6` | 6,65 | AA |
| Sombre : texte `#F3F1EC` sur `#0A1628`, secondaire `#AEB9CB` sur `#13233F` | 16,06 / 7,91 | AA |
| **Doré `#C49A2C` utilisé comme texte sur blanc** | **2,62** | **Interdit** (déjà interdit par la règle doré ; à corriger là où il existe). |
| **Texte doré `#8A6A12` sur doré pâle `#F4ECD6`** (pastille « Bloquée » actuelle) | **4,29** | **Échec AA** — disparaît avec la règle §8 (plus de statut doré). |

### 3.3 Règles

1. **La couleur ne porte jamais seule une information** : toujours un libellé, plus un point, une icône ou une forme.
2. **Le doré n'est jamais un statut** (V06). Les états « en attente » passent en Attention ou Information selon qu'une action est attendue ou non.
3. **Aucun dégradé** (prompt, interdits) : le dégradé de marque `BRAND_GRADIENT` et les autres dégradés (barre latérale `AppShell`, en-têtes BUILD et CONTROL, héros et cartes du catalogue client, page publique) sont remplacés par l'aplat bleu nuit `#0B1D3A`. Les **hachures** du marquage démo (`repeating-linear-gradient` à arrêts francs) sont un motif, pas un dégradé : elles restent.
4. Le bleu est réservé aux liens et au rôle Information, jamais à un texte descriptif (V12).
5. Mode sombre : conservé tel qu'il existe (tokens complets), non étendu au-delà (prompt).

## 4. Typographie

| Rôle | Police | Graisses | Usage |
|---|---|---|---|
| Interface | **Manrope** (actuelle, PO-11) | 400, 500, 600, 700 | Tout le texte d'interface. Chiffres tabulaires (`font-variant-numeric: tabular-nums`) sur montants, dates, compteurs. |
| Titres et actes | **Fraunces** (actuelle, « titres à empattements » de PO-11) | 600 | Titre de page, titre de contrat, avec parcimonie : un seul par écran. |
| Références | **IBM Plex Mono** (à ajouter) | 400, 500 | Référence bancaire simulée, identifiant d'instance, numéro de version, empreinte de pièce, identifiant de mission. Copiable. |

Le prompt propose IBM Plex Sans et Source Serif 4 : l'identité validée (PO-11) les remplace par Manrope et Fraunces, voir A-DS-1.

**Échelle** (px) : 12 · 13 · 14 · 16 · 20 · 24 · 32. Corps d'interface 14 px sur les vues bureau (gestionnaire, contrôleur, Finance, administrateur), **16 px** sur les vues mobiles client et chantier. Titres de page : 24 px (mobile) / 32 px (bureau). Aucun titre au-delà de 32 px, y compris sur la page publique (V02 : pas de « hero » géant).

**Sur-titres en majuscules espacées** (« ESPACE ACQUÉREUR », « VENTES · FINANCE ») : supprimés (V01). Le contexte est porté par la navigation et le titre.

## 5. Forme

### 5.1 Espacements
Multiples de 4 px : 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48. Les jetons `spacing` actuels (4 à 24) sont complétés par 32 et 48.

### 5.2 Rayons (V04, V09)
- **4 px** : champs, boutons, badges d'état, marqueurs.
- **6 px** : panneaux, tableaux, justificatifs.
- Rien au-delà. Les rayons actuels (12 à 24 px, pastilles 999 px) sont ramenés à ces deux valeurs.

### 5.3 Bordures et ombres (V03, V05)
- Séparation par **bordure 1 px** `--keya-neutral-border`, jamais par une ombre.
- **Une seule ombre**, légère, réservée aux menus déroulants et modales (`--keya-shadow-md` conservé pour cet usage ; ses 5 usages actuels sur des cartes et `--keya-shadow-sm` (14 usages) sont remplacés par des bordures ; `-lg` retiré).
- Pas de liseré coloré à gauche des cartes, pas d'en-tête mobile « flottant » arrondi : en-tête pleine largeur.
- Pas de carte dans une carte : une page = des sections séparées par des bordures ou de l'espace.

### 5.4 Icônes (V08)
- Grille 24, **trait 1,5**, 16 px (bureau) / 20 px (mobile), `currentColor`.
- **Une icône par concept** : portefeuille = encaissements ; balance = paliers du Country Pack ; bouclier = contrôle ; utilisateurs = comptes ; immeuble = programme ; document = contrat et pièces. Plus d'icône réutilisée pour des sens différents.
- Aucune icône « étincelles » ni vocabulaire IA ; aucun emoji.
- Source des tracés : voir A-DS-2 (Lucide imposé par le prompt, tracés maison aujourd'hui).

### 5.5 Mouvement
Transitions de 120 à 180 ms sur les états d'interaction (survol, focus, ouverture d'un menu) uniquement. Aucune animation d'entrée, aucun compteur animé. `prefers-reduced-motion` respecté.

## 6. Interdits (prompt, rappel opposable)

Dégradés ; violet, indigo, néon, glassmorphism, flou ; emojis ; hero centré géant, grilles « 3 features », témoignages, compteurs animés ; **scores globaux, jauges de confiance, étoiles, pourcentages de fiabilité** (CDC §1) ; illustrations 3D, images IA, photos stock ; logos de banques ou partenaires réels (CDC §3) ; vocabulaire visuel IA ; textes marketing creux ; **tout état affiché comme accompli alors qu'il n'a pas eu lieu** (CDC §9.2).

## 7. Marquage démonstration et simulation (CDC §3.1)

Élément de premier rang, différencié **par la forme** (hachures diagonales fines neutres), jamais par une couleur de statut ni par le doré.

| Élément | Règle | Existant |
|---|---|---|
| Bandeau permanent | « DÉMONSTRATION — DONNÉES FICTIVES » + identifiant d'instance **en IBM Plex Mono**, en haut de chaque écran, collant, non masquable, sur toutes les apps y compris connexion et page publique. | `DemoBanner` (audit M01/M02). À faire : identifiant en Plex Mono. |
| Acte simulé | « SIMULÉ — SANS VALEUR OPÉRATIONNELLE » accolé à l'élément (signature, contrôle d'identité, exécution bancaire, encaissement, rapprochement, décaissement, confirmation bénéficiaire). | `SimulatedMark` (audit M03/M04). |
| Instance archivée | Bandeau supplémentaire « ARCHIVE — LECTURE SEULE » sous le bandeau démo ; toutes les actions visibles mais désactivées, avec explication. | **À créer** (`ArchiveBanner`), lié à T14. |
| PDF et exports | Filigrane diagonal + en-tête et pied de page avec le marquage et l'instance. | **À créer** quand un export existera (aucun export PDF aujourd'hui). |

## 8. États de travail ≠ niveaux de confiance (CDC §7)

### 8.1 Deux grammaires distinctes

- **États** (réservation, contrat, jalon, mouvements, décaissement) : **badge compact** rayon 4 px, point de couleur + libellé, hauteur 20 px. Remplace les pastilles arrondies actuelles (`Pill`, V09).
- **Niveaux de confiance** (Déclaré → Documenté → Contrôlé → Vérifié → Validé) : **échelle en étapes**, jamais un badge ni une jauge. Chaque niveau atteint affiche **qui, quand, sur quelle version, dans quel périmètre** ; un niveau non atteint reste visible et vide. « Validé techniquement — démonstration » cite toujours le contrôleur. Aucun cumul en score, aucun pourcentage. Composant **à créer** (`TrustLevels`).

### 8.2 Couleur d'un état

| Famille | Couleur | Exemples |
|---|---|---|
| Accompli | Succès | Concrétisée, Signé (simulé), Accepté techniquement, Rapproché (simulé), Réserve levée. |
| Action attendue de quelqu'un | Attention | Bien bloqué, Soumis, Corrections demandées, Éligible, Signalé — non encaissé. |
| En cours, rien à faire | Information | En revue, En examen, Resoumis, Exécuté par la banque (simulé). |
| Refus, fin sans aboutir | Critique | Annulée, Expirée, Réserve ouverte, Introuvable au relevé. |
| Neutre | Texte secondaire | Brouillon, Planifié, Demandée. |

### 8.3 Glossaire (identifiant technique → affichage)

Libellés cibles du prompt ; la colonne « Actuel » montre l'existant et les écarts à corriger à l'étape 3 (libellés serveur, `TextChoices`).

| Objet | Identifiant | Cible | Actuel |
|---|---|---|---|
| Réservation | `requested` | Demandée | Demandée |
| | `held` | **Bien bloqué** | Bloquée |
| | `reserved` | Réservée | Réservée |
| | `committed` | Concrétisée | Concrétisée |
| | `expired` / `cancelled` | Expirée / Annulée | Expirée / Annulée |
| Contrat | `draft` / `review` / `approved` | Brouillon / En revue / Approuvé | identique |
| | `signed_simulated` | **Signé (simulé)** | Signé (simulation) |
| Jalon | `DRAFT` … `TECHNICALLY_ACCEPTED` (CDC §7.1) | Brouillon · Soumis · En examen · Corrections demandées · Resoumis · Accepté techniquement | Non déclaré · Déclaré — pièce à joindre · En attente de contrôle · Sous réserve · Accepté techniquement (voir A-DS-4) |
| Décaissement (demande) | `draft` / `eligible` / `executed_sim` / `cancelled` | Brouillon · **Éligible** · Exécuté (simulé) · Annulé | « Éligible (montant réservé) » |
| Mouvement financier | `planned` | **Planifié** | Prévu |
| | `bank_executed_sim` | **Exécuté par la banque (simulé)** | Reçu en banque (simulé) / Exécuté en banque (simulé) |
| | `reconciled_sim` | Rapproché (simulé) | identique |
| | `beneficiary_confirmed_sim` | Confirmé par le bénéficiaire (simulé) | identique |
| Signalement de virement (PO-05) | `declared` / `confirmed` / `rejected` | Signalé — non encaissé · Traité — encaissement enregistré · Introuvable au relevé (simulé) | identique (étape 2) |
| Réserve | `ouverte` … `levee` | Ouverte · Correction proposée · En recontrôle · Maintenue · Levée | identique |

## 9. Montants, dates, références

- **Montants** : entiers XOF, séparateur de milliers = espace fine insécable (U+202F), code devise toujours visible : `30 000 000 XOF`. Alignés à droite dans les tableaux, chiffres tabulaires. Un seul formateur partagé (aujourd'hui dupliqué dans plusieurs apps).
- **Six notions distinctes, jamais confondues** : attendu (appelé), encaissé, affecté, **non affecté (jamais masqué)**, réservé, disponible. Chacune a son libellé ; le non affecté est en gras quand il est non nul.
- **Dates** : `27 sept. 2026, 14:05 (GMT, Abidjan)` dans les détails et l'historique ; jour seul : `28 sept. 2026`. Formateur unique `formatServerDateTime` / `formatCalendarDate` (déjà en place, F06).
- **Références** (bancaire simulée, instance, version, empreinte, mission) : IBM Plex Mono, bouton « Copier » discret.
- Surfaces : `75 m²`, sans décimales inutiles (X01). Accords réels : « 2 lots », jamais « lot(s) » (X02).

## 10. Traçabilité visible — composants à créer

| Composant | Contenu | Règles |
|---|---|---|
| `Timeline` (chronologie d'audit) | Liste verticale : acteur + rôle, action, date serveur, justification, lien vers l'objet et sa version. | Lecture seule, aucun bouton d'édition. Source : journal (`AuditEvent`) et `TrustEvent`. |
| `VersionHistory` | Version courante en avant ; versions antérieures consultables, jamais supprimées. | Un avis reste visuellement attaché à la version examinée (K01). |
| `ReserveCard` | Ouverte / levée, date, auteur, motif, action attendue, correction proposée, décision du contrôleur. | Reprend les champs structurés de l'étape 1 (K02, K03). |
| `TrustLevels` | Échelle des 5 niveaux (§8.1). | Aucun score. |
| `Indicator` | Chiffre cliquable jusqu'à ses sources, numérateur / dénominateur visibles. | Dénominateur nul → « Non applicable », jamais « 100 % » (CDC §9.3). |
| `Money`, `DateTime`, `Reference` | Affichages normalisés §9. | Chiffres tabulaires, Plex Mono pour les références. |
| `ReceiptProof` | Justificatif bancaire fictif (existe dans deux écrans, à unifier). | Toujours avec `SimulatedMark`. |

## 11. Deux espaces par rôle

| | Client, constructeur (HOME, BUILD) | Gestionnaire, contrôleur, Finance, administrateur (web, CONTROL) |
|---|---|---|
| Priorité | **Mobile d'abord** (375 px) | **Bureau d'abord** (1440 px) ; CONTROL reste mobile d'abord (terrain) |
| Corps | 16 px, contraste élevé (lisible en plein soleil) | 14 px, tableaux denses |
| Actions | Une action principale par écran, cibles 44 px, formulaires courts | Filtres, tri, panneau de détail latéral, raccourcis clavier discrets |
| Navigation | **Barre supérieure simple** (X05 : la barre latérale est trop lourde pour deux entrées) | Barre latérale regroupée par métier (existante) |
| Ton | Rassurant et factuel ; la sortie de fonds vers le constructeur est une sortie **du programme**, jamais une dette du client | Métier, précis |
| Finance | — | Vue de rapprochement de type **relevé bancaire** : une ligne par mouvement, colonnes date · référence · libellé · montant · affecté · non affecté · état |

## 12. États d'écran et accessibilité (CDC §9.2, T20)

- **Chargement** : squelettes sobres aux dimensions du contenu ; pas de spinner plein écran.
- **Vide** : une phrase utile + la prochaine action (« Aucun encaissement enregistré. Enregistrez le premier depuis le relevé fictif. »).
- **Erreur** : message compréhensible, sans détail technique ni donnée d'un autre dossier ; bouton « Réessayer ».
- **Succès** : confirmation sobre, dans le flux (pas de toast animé).
- **Action interdite** : bouton visible mais désactivé, avec l'explication (« Seul le bureau de contrôle peut lever une réserve »), sans révéler de donnée confidentielle.
- **Clavier** : navigation complète, **focus visible = anneau 2 px bleu nuit** (clair) / crème (sombre), libellés de formulaire explicites, aucun débordement horizontal à 375 px.
- **Cloche** : compteur affiché seulement s'il y a des notifications (V10).
- **Formulaire de connexion** : aligné à gauche, sans carte centrée, bouton principal non pleine largeur (V11).

Tests de gouvernance à ajouter (étape 3) : aucun dégradé ; doré limité à la marque et au bouton principal ; aucun rayon > 6 px ; aucune couleur en dur hors tokens ; marquage présent sur chaque écran.

## 13. Écarts entre l'existant et ce document (traités à l'étape 3)

| Constat | Écart actuel | Cible |
|---|---|---|
| V01 | Sur-titres dorés en majuscules sur presque chaque bloc. | Supprimés. |
| V02 | Page publique : titre + deux boutons + carte translucide à trois arguments. | Mise en page éditoriale sans carte « features ». |
| V03 | Cartes KPI à gros chiffre à empattements, y compris à 0. | Chiffres en ligne de synthèse ou en tête de tableau ; zéros discrets. |
| V04 | Cartes empilées, rayons 12–24 px. | Sections, rayons 4/6 px. |
| V05 | Liseré doré à gauche, en-tête mobile flottant avec ombre. | En-tête pleine largeur, pas de liseré. |
| V06 | Doré sur marque, sur-titres, navigation active, liserés, statut « en cours », boutons secondaires. | Marque + action principale seulement ; statuts en §8.2. |
| V07 | Icône immeuble générique pour tous les biens. | Plan ou façade au trait du projet, marqué fictif, ou pas de visuel. |
| V08 | Icônes réutilisées pour des sens différents. | Une icône par concept (§5.4). |
| V09 | Pastilles arrondies pour statuts. | Badge compact rayon 4 px, point + libellé. |
| V10 | Cloche « 0 » permanente. | Compteur seulement si non nul. |
| V11 | Connexion en carte centrée, bouton doré pleine largeur. | Formulaire aligné à gauche, sans carte. |
| V12 | Textes descriptifs en bleu. | Bleu réservé aux liens et à l'Information. |
| X01–X05 | Surfaces décimales, « lot(s) », date isolée sans année, gris « À venir » à vérifier, barre latérale client. | §9, §11, contraste vérifié par test. |
| Dégradés | `BRAND_GRADIENT` et dégradés dans 7 fichiers (barre latérale, en-têtes BUILD/CONTROL, héros et catalogue client, page publique). | Aplat bleu nuit ; hachures du marquage conservées. |
| Contraste | Pastille « Bloquée » (texte doré sur doré pâle) à 4,29:1. | Supprimée par §8.2. |
| Glossaire | Libellés serveur différents de la cible (§8.3). | Alignés à l'étape 3 (migration `sales/0014`, jalons dérivés côté serveur). |

## 14. Points à arbitrer par le Product Owner

| ID | Question | Proposition |
|---|---|---|
| **A-DS-1** | Polices : le prompt demande IBM Plex Sans (interface) et Source Serif 4 (titres) ; l'identité actuelle (PO-11) utilise Manrope et Fraunces. | **Garder Manrope et Fraunces** (identité validée, aucun changement perçu), **ajouter IBM Plex Mono** pour les références. Alternative : adopter Plex Sans + Source Serif 4 (plus « registre », mais c'est une refonte typographique). |
| **A-DS-2** | Icônes : le prompt impose Lucide (trait 1,5) ; le projet a 17 tracés maison sans dépendance. | Reprendre les **tracés Lucide** (licence ISC, notice conservée) **en ligne** dans `Icon/paths.ts`, trait 1,5, sans ajouter de dépendance npm. Alternative : ajouter le paquet `lucide-react`. |
| **A-DS-3** | Galerie des composants : pas de Storybook. | Page interne **`/design-system`** dans `apps/web`, accessible sans compte **uniquement en environnement DÉMO**, sur données fictives, montrant chaque composant dans tous ses états. |
| **A-DS-4** | Jalons : le CDC §7.1 et le prompt prévoient Brouillon · Soumis · En examen · Corrections demandées · Resoumis · Accepté techniquement ; le serveur dérive aujourd'hui Non déclaré · Déclaré — pièce à joindre · En attente de contrôle · Sous réserve · Accepté techniquement. | Aligner l'affichage sur le CDC en dérivant les états cibles côté serveur (sans changer le modèle), lors de l'écran chantier. |
| **A-DS-5** | Rôle Information : absent de la palette actuelle. | Ajouter `#23577F` / `#E8F0F6` (clair) et `#9CC3E4` / `#10263D` (sombre), valeurs du prompt, contrastes AA vérifiés. |
| **A-DS-6** | Libellé du bandeau d'état « Bien bloqué » au lieu de « Bloquée » pour une réservation : c'est un libellé serveur visible partout. | Adopter « Bien bloqué » (prompt). |

## 15. Suite, après validation

1. **Tokens** : couleur Information, rayons 4/6, ombre unique, suppression des dégradés, Plex Mono, échelle typographique ; tests de gouvernance.
2. **Galerie** `/design-system` (A-DS-3) avec chaque composant dans chaque état, dont les nouveaux (§10).
3. **Écrans du CDC §9.2**, un par un, avec captures 375 px et 1440 px en clair, deux passes de relecture critique, et la liste des écarts à chaque écran.

Aucune de ces étapes ne commence avant votre validation de ce document.

## 16. Mise en œuvre (étape 3, PO-2026-09-27-20)

| Élément | Où |
|---|---|
| Jetons (Information, rayons 4/6, ombre unique `--keya-shadow-overlay`, Plex Mono) | `packages/design-system/src/components/GlobalStyles/GlobalStyles.tsx`, `tokens/` |
| Formateurs partagés montant, surface, accord | `packages/design-system/src/format/numbers.ts` (`formatMoney`, `formatSurface`, `pluralize`) |
| Badge d'état compact (point + libellé, rayon 4 px) | `Pill` (familles §8.2 ; `accent` → Attention, `primary` → Information) |
| Traçabilité | `Timeline`, `VersionHistory`, `ReserveCard`, `TrustLevels`, `Indicator`, `Money`, `DateTime`, `Reference`, `ReceiptProof` (unifié), `ArchiveBanner`, `Skeleton`, `EmptyState` |
| Barre supérieure client (X05) | `AppShell navigation="topbar"` (HOME) |
| Galerie (A-DS-3) | `apps/web` → `/design-system`, refusée hors environnement `DEMO` |
| Libellés serveur (A-DS-4, A-DS-6, §8.3) | `apps/sales/models.py` (migration `sales/0014`), `apps/inspections/services.py` (`milestone_cdc_state`) |
| Gouvernance | `designSystemGovernance.test.ts` (dégradés, flou, rayons, ombres, doré, texte doré), `contrastGovernance.test.tsx` (contrastes AA clair et sombre) |

Restent hors de cette étape (voir le compte rendu) : l'échelle `TrustLevels` n'est pas encore branchée sur les écrans (il faut exposer, par niveau, qui / quand / version / périmètre côté serveur) ; `StatusBadge` (niveau de confiance en badge) subsiste dans BUILD « À traiter » et dans l'ancienne vue HOME `OverviewView` ; export PDF filigrané à créer avec le premier export.
