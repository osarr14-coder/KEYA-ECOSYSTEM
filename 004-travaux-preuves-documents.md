# Ticket 004 — Travaux déclarés, preuves et GED minimale

## Objectif
Un constructeur déclare un travail terminé sur un jalon et y attache des preuves
(photos, documents). Chaque déclaration génère un `TrustEvent` de niveau "déclaré",
chaque preuve ajoutée génère un `TrustEvent` de niveau "documenté".

## Entités touchées
- `WorkDeclaration`
- `Evidence`
- `Document` (GED minimale)
- Relation polymorphe `Document` × objet métier (un document n'est pas automatiquement
  une preuve — une `Evidence` peut référencer un `Document`, mais pas l'inverse)

## Scope inclus
- `Document` : `id`, `category`, `owner_id`, `visibility`, `hash`, `version`,
  `sensitivity_level`, stockage objet (S3-compatible) avec URL signée temporaire
- `WorkDeclaration` : rattaché à un `Milestone`, déclaré par un utilisateur avec rôle
  constructeur, génère un `TrustEvent`
- `Evidence` : rattaché à une `WorkDeclaration`, référence un ou plusieurs `Document`,
  génère un `TrustEvent`
- Upload de média avec compression et génération de miniature côté serveur (traitement
  asynchrone via la queue)

## Critères d'acceptation
- [ ] Un document classifié `sensitivity_level = confidentiel` ou plus n'est jamais
      accessible via une URL non signée ou sans vérification de permission
- [ ] La déclaration d'un travail et l'ajout d'une preuve créent chacun un `TrustEvent`
      distinct, jamais un seul événement fusionné
- [ ] Une photo prise puis uploadée reste associée à sa provenance complète (source,
      date, auteur) même après compression/traitement asynchrone

## Explicitement hors scope
- Antivirus sur upload (mentionné en V3.0 16.3, à traiter en durcissement post-MVP)
- Recherche full-text sur les documents

## Dépendances
Tickets 002 et 003.
