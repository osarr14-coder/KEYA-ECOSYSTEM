# ADR 0003 — Stack Django + PostgreSQL (plutôt que Node/NestJS)

## Statut

**Accepté et déjà implémenté.** L'ensemble du backend (`backend/`, tous les tickets
001 à 020) est écrit en Django + PostgreSQL. Cette ADR documente rétroactivement une
décision prise en cours de route, faute de l'avoir actée formellement au moment où
elle a été prise.

## Contexte

La recommandation technique initiale pour le backend de KEYA ECOSYSTEM était
Node/NestJS — un choix cohérent avec un écosystème JavaScript/TypeScript de bout en
bout (le frontend du projet est déjà en React/TypeScript).

Cette recommandation a été écartée en cours de route au profit de Django + PostgreSQL,
pour cohérence avec l'écosystème KEYA/UTB existant : le projet KEYA CRM
(`C:\Projets claude\KEYA`) et le projet UTB (`C:\Projets claude\UTB`) sont tous deux
construits sur Django + PostgreSQL. Faire diverger KEYA ECOSYSTEM sur une stack
différente (Node/NestJS) aurait introduit une deuxième stack backend à maintenir,
sans bénéfice fonctionnel direct pour ce projet, pour une équipe qui opère déjà les
deux autres projets en Django.

## Décision

Backend Django + PostgreSQL, tel qu'implémenté depuis le ticket 001
(`001-fondations-auth-organisations.md`) : Django REST Framework, `django.contrib.auth`
avec `AUTH_USER_MODEL` personnalisé, PostgreSQL avec Row-Level Security (RLS) posée par
migrations (`apps.core.rls.set_rls_context`, `SET LOCAL` par transaction — voir
CLAUDE.md et ADR 0001).

## Conséquences

- **Django Admin comme filet de sécurité pour le back-office.** Le ticket 011
  (`011-messagerie-backoffice-minimal.md`) livre un back-office minimal applicatif
  (recherche utilisateur, désactivation de compte), mais Django Admin reste disponible
  en secours pour toute opération d'administration non encore couverte par une vue
  dédiée — un filet que NestJS n'aurait pas fourni nativement, il aurait fallu le
  construire.
- **RLS via migrations PostgreSQL, indépendant de l'ORM.** Les policies RLS sont posées
  au niveau PostgreSQL (migrations SQL), pas au niveau de la couche applicative — le
  choix Django vs NestJS n'aurait rien changé à cette partie : un backend Node/NestJS
  aurait dû implémenter exactement le même mécanisme `SET LOCAL` par transaction pour
  respecter les mêmes policies RLS. Ce n'est donc pas un argument en faveur de Django,
  mais une confirmation que le changement de stack n'a pas remis en cause l'architecture
  RLS déjà actée.
- **Cohérence d'équipe et de compétences.** Une seule stack backend (Django) à opérer
  sur les trois projets (KEYA CRM, UTB, KEYA ECOSYSTEM), plutôt que deux stacks
  distinctes en parallèle.
- **Coût non mesuré ici** : cette ADR ne documente pas de comparatif chiffré
  Node/NestJS vs Django (performance, écosystème de librairies, etc.) — la décision a
  été prise sur un critère de cohérence d'écosystème, pas sur un banc d'essai
  technique. À noter pour quiconque voudrait remettre ce choix en question plus tard.

## Note sur la numérotation

Cette ADR porte le numéro 0003, pas 0002 comme demandé initialement — `docs/adr/0002-
control-conflict-resolution-discard-only.md` existe déjà sur `master` (résolution de
conflit CONTROL par abandon seul). Signalé pour éviter toute confusion avec un futur
renommage.
