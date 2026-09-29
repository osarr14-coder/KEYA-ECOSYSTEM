# Proposition — archive d'instance consultable en lecture seule (CDC §9.2 étape 11, T14)

| | |
|---|---|
| Décision | PO-2026-09-28-25 : proposition seulement — **remplacée par PO-2026-09-28-47** ; **implémentée au lot 5** (PO-2026-09-29-01 à -04), avec les écarts ci-dessous |
| Écarts retenus | Consultation réservée à l'administrateur et au gestionnaire, back-office seulement (A6) ; garde d'écriture au niveau des modèles en plus de la requête ; suppression des archives échues non automatisée (PO-2026-09-29-04) |
| Exigences | CDC R1 §9.2 étape 11 (« archives consultables en lecture seule selon droits »), §9.3 (archives exclues des indicateurs actifs), §10 (archive cohérente, interdit ses nouvelles écritures), T14 |
| Existant | `DemoInstance` (code, version du jeu, statut `ACTIVE`/`ARCHIVED`, date d'archivage, instance d'origine) ; une seule instance active ; programmes rattachés à une instance ; filtre `demo_scope` (15 appels) qui ne liste que l'instance active ; commande `archive_demo_instance --confirm [--reseed]` |

## 1. Principe

Une instance archivée reste **dans la base**, intacte. On ne la supprime pas et on ne la recopie pas. L'application la présente en **lecture seule**, derrière un sélecteur d'instance réservé aux rôles autorisés. Tout ce qui écrit est refusé **par le serveur** dès que l'objet visé appartient à une instance archivée.

## 2. Consultation selon les droits

| Rôle | Accès à une archive |
|---|---|
| Gestionnaire, Finance | Consultation de leurs écrans habituels (dossiers, appels, encaissements, comptes, jalons) sur l'instance choisie. |
| Administrateur | Journal d'audit et liste des instances (code, version du jeu, dates, instance d'origine) ; pas de données métier (R02). |
| Constructeur, contrôleur | Consultation de leurs jalons, pièces et avis de l'instance choisie, dans leur seul périmètre (RLS inchangé). |
| Client | Ses seuls dossiers de l'instance archivée ; aucune autre donnée. |
| Visiteur (page publique) | Aucun accès : la page publique ne montre que l'instance active. |

Mécanique proposée :
- **Paramètre d'instance** : l'en-tête `X-Demo-Instance-View: <code>` est accepté seulement si l'instance existe et que le rôle y a droit. Sans en-tête, on lit l'instance active, comme aujourd'hui.
- **Filtre** : `demo_scope()` reçoit l'instance demandée au lieu de l'instance active. Les 15 appels existants restent inchangés. Les policies RLS restent inchangées : elles filtrent déjà par organisation et par utilisateur.
- **Écritures** : un garde-fou commun (`ensure_writable(instance)`) est appelé par chaque service qui écrit ; il **refuse** (409, « Instance archivée — lecture seule ») toute écriture sur un objet d'instance archivée. Un test de garde parcourt toutes les routes d'écriture de l'API.
- **Fichiers** : les pièces d'une archive restent téléchargeables selon les droits actuels ; aucun nouveau dépôt n'est possible.

## 3. Bandeau « ARCHIVE — LECTURE SEULE »

- Le composant `ArchiveBanner` du design system (déjà présent dans la galerie) s'affiche en tête de chaque écran de chaque app. Il remplace le bandeau démo tant qu'une archive est consultée. Texte : « ARCHIVE — LECTURE SEULE · Instance DEMO-CI-… · archivée le … », avec un lien « Revenir à l'instance active ».
- Les boutons d'action restent visibles mais désactivés, avec l'explication « Instance archivée : aucune modification possible » (règle §9.2 : une action interdite est expliquée).
- Une couleur neutre distincte de la démo active ; jamais le rouge, puisqu'il ne s'agit ni d'une erreur ni d'un refus (PO-2026-09-28-17).

## 4. Exclusion des indicateurs actifs

- Tous les indicateurs (§9.3 : jalons examinés, paiements rapprochés, réserves, pièces) sont calculés **sur l'instance active seulement** : ils passent tous par `demo_scope()` avec l'instance active, et le paramètre d'instance est ignoré pour eux.
- Une archive peut afficher **ses propres** indicateurs, calculés sur elle seule et étiquetés « Archive — DEMO-CI-… ». Ils ne sont jamais additionnés à ceux de l'instance active.
- Test : un parcours joué puis archivé laisse les indicateurs de la nouvelle instance à zéro (« Non applicable » quand le dénominateur est nul).

## 5. Points à trancher avant l'implémentation

1. **Comptes partagés** : les 7 comptes de démonstration sont communs aux instances. Un client voit-il ses anciens dossiers archivés, ou seulement ceux de l'instance active ? Proposition : l'instance active par défaut, l'archive sur demande explicite.
2. **Rétention** : durée de conservation et responsable des archives (§10 : « définir responsable, rétention et accès aux archives avant hébergement »).
3. **Réinitialisation complète ou archivage** : la procédure actuelle (`reset_demo_local.sh`) remplace la base ; l'archivage (`archive_demo_instance --reseed`) conserve l'instance en base. Quand l'archive est consultable, l'archivage devient la voie normale et la réinitialisation complète un recours d'exploitation.

## 6. Effort estimé

| Lot | Contenu | Effort |
|---|---|---|
| Serveur | Paramètre d'instance et contrôle des droits, `demo_scope` paramétré, garde-fou d'écriture sur tous les services qui écrivent, en-têtes | 3 à 4 jours |
| Tests serveur | Garde « aucune écriture sur une archive » (toutes routes), droits par rôle, indicateurs exclus, fichiers | 2 jours |
| Front (4 apps) | Sélecteur d'instance (rôles autorisés), `ArchiveBanner`, actions désactivées avec explication, retour à l'instance active | 3 jours |
| Captures, documentation, recette | 375 / 1440 px, clair / sombre, mise à jour de la procédure T14 | 1 à 2 jours |
| **Total** | | **9 à 11 jours** |

Principal risque : oublier un chemin d'écriture. Le test de garde qui parcourt toutes les routes d'écriture est la protection prévue.
