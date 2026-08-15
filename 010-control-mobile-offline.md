# Ticket 010 — CONTROL : mobile offline de base

## Objectif
Un inspecteur peut mener une inspection en mobilité et réseau dégradé sans perte de
provenance — critère d'acceptation produit 26.3 de la V3.0. Ticket techniquement le
plus risqué du MVP 1 : à traiter avec le plus de marge de test.

## Scope inclus
- PWA distincte (`/apps/control-pwa`), interface tactile 360-430px
- Missions : liste des inspections à mener, checklist, photos, commentaire, décision
  (conforme / réserve), le tout stocké en IndexedDB avant synchronisation
- File de synchronisation : statut `pending / syncing / synced / conflict` par item,
  horodatage double (heure device au moment de la saisie, heure serveur à réception)
- Politique de conflit : jamais de last-write-wins silencieux — un conflit détecté doit
  rester visible et nécessiter une action explicite de l'inspecteur ou d'un rôle habilité
- File média : compression côté client avant mise en queue d'upload, retry avec backoff

## Critères d'acceptation
- [ ] Une inspection saisie en mode avion complet, avec photos, survit à une fermeture
      complète de l'application avant reconnexion, et se synchronise sans perte au
      retour du réseau
- [ ] Un scénario de conflit simulé (deux mises à jour concurrentes sur la même
      inspection) ne provoque jamais un écrasement silencieux — testé explicitement
- [ ] Chaque item synchronisé porte un correlation ID généré côté client dès la saisie
      hors ligne, traçable de bout en bout côté observabilité serveur

## Explicitement hors scope
- Accès natif caméra/GPS avancé (React Native) — la PWA avec `<input capture>` suffit
  tant que le besoin natif n'est pas prouvé
- Missions PRO (artisan) — ce ticket couvre uniquement CONTROL

## Dépendances
Tickets 003, 004, 005. Peut démarrer en parallèle du ticket 009 une fois ces trois
tickets stables.
