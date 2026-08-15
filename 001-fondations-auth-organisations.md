# Ticket 001 — Fondations : auth, organisations, RBAC de base

## Statut
Premier ticket. Tout le reste du MVP 1 en dépend.

## Objectif
Un utilisateur peut se créer un compte, appartenir à une ou plusieurs organisations avec
un rôle, et toute requête API est automatiquement scopée par organisation.

## Entités touchées
- `User`
- `Organization`
- `Membership` (User × Organization × Role)
- `Role` (valeurs de départ : `client`, `sponsor`, `constructeur`, `inspecteur`, `admin_keyimmo`)

## Scope inclus
- Authentification (email + mot de passe pour le MVP ; provider managé, voir ADR auth)
- Modèle `Organization` avec `country_pack_id` (référence, même si CountryPack n'a qu'une
  seule valeur "Sénégal" codée en base pour l'instant, jamais en dur dans le code)
- `Membership` avec un rôle unique par (user, organization) pour le MVP — multi-rôle
  par organisation est hors scope ici
- Middleware API : toute requête authentifiée résout l'organisation active et applique
  une policy PostgreSQL row-level security sur `organization_id`
- Endpoint `GET /me` retournant l'utilisateur, ses organisations et rôles

## Critères d'acceptation
- [ ] Un utilisateur ne peut jamais lire ou écrire une donnée d'une organisation dont il
      n'est pas membre, même en forgeant une requête avec un `organization_id` différent
      (test : tentative volontaire de contournement, doit échouer au niveau DB, pas
      seulement au niveau applicatif)
- [ ] La policy RLS est testée par un test d'intégration, pas seulement documentée
- [ ] `CountryPack` existe comme table séparée dès ce ticket, même avec une seule ligne

## Explicitement hors scope
- App Switcher, permissions fines par objet (ABAC complet) — viendra une fois plusieurs
  rôles réels en usage
- Gestion de mot de passe oublié / invitations par email (peut être stub pour le MVP)

## Dépendances
Aucune — ticket de démarrage.
