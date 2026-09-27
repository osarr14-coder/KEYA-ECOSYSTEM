# B-053 — Scénario de démonstration et accès (Phase 3)

## Contexte

Demande utilisateur : « fournis-moi aussi des accès pour me connecter et visualiser le
flow ». Les serveurs de développement tournent dans un conteneur cloud éphémère,
injoignable depuis l'extérieur ; l'ouverture d'un tunnel public vers ce conteneur a été
refusée par la politique de sécurité de la session (non contournée). La voie durable est
le déploiement Render du dépôt (`render.yaml`, redéploiement à chaque push sur `master`).

## Scope

- Commande `seed_demo_scenario` (app `apps/sales`) : comptes de démonstration par rôle
  (2 clients, ADV, admin, Finance, constructeur, bureau de contrôle), programme
  « Résidence Démonstration Abidjan » dans l'organisation du promoteur-constructeur
  (2 lots à 30 000 000 XOF, CDC §9.1 — le constructeur peut ainsi déclarer ses jalons
  dans BUILD), barème de paiement de démonstration.
- **Opt-in** : ne fait rien sans `DEMO_PASSWORD` (ou `--password`), choisi par le
  propriétaire du déploiement, jamais écrit dans le dépôt ; 10 caractères minimum.
- **Idempotente** : remet à jour comptes, rôles et mot de passe ; ne touche jamais à un
  programme déjà créé (une démonstration en cours n'est pas réinitialisée).
- Branchée dans le `buildCommand` de `render.yaml` ; variable `DEMO_PASSWORD`
  (`sync: false`) ; mode d'emploi dans `DEPLOY_RENDER.md`.

## Limites connues

- Les étapes financières (appels, encaissements, décaissements) n'ont pas encore d'écran :
  F-068. Le compte Finance ne dispose donc d'aucune interface pour l'instant.
- Réinitialisation / archivage d'instance de démonstration (T14) : Phase 4.

## Critères d'acceptation

- Sans `DEMO_PASSWORD` : aucun compte créé.
- Avec : chaque compte se connecte ; une seconde exécution ne modifie pas le programme.
