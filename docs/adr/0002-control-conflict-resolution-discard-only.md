# ADR 0002 — Résolution de conflit CONTROL : abandon explicite seul (MVP)

## Statut

**Décision produit assumée pour le MVP** (ticket 010, passe 2). Ce n'est **pas** une
limite provisoire à corriger au prochain sprint. Une résolution avec fusion assistée ou
arbitrage par un rôle habilité est **explicitement reportée**, et ne sera ticketisée que
si ce scénario se révèle fréquent en usage réel pendant le pilote — pas avant, et pas par
défaut.

## Contexte

Le ticket 010 (passe 2) exige : « un conflit détecté doit rester visible et nécessiter
une action explicite de l'inspecteur ou d'un rôle habilité », sans détailler la nature de
cette action. Le mécanisme de DÉTECTION lui-même (comparaison de
`expected_latest_event_id` au dernier `TrustEvent` réellement présent sur la cible,
`apps.inspections.services.create_inspection`, testé dans la même transaction que la
création — voir CLAUDE.md, section « CONTROL PWA — synchronisation réelle ») est
rigoureusement correct et testé, y compris le scénario explicite de deux mises à jour
concurrentes. La question restée ouverte était uniquement : **que proposer à
l'inspecteur une fois le conflit détecté ?**

Deux résolutions plus riches étaient envisageables :

1. **Fusion assistée** — présenter la version locale et la version serveur côte à côte,
   laisser l'inspecteur composer une version finale.
2. **Arbitrage par un rôle habilité** distinct de l'inspecteur — mentionné explicitement
   par le ticket (« ou d'un rôle habilité »).

## Décision

Une seule action est construite : **abandonner la saisie locale devenue obsolète**
(`InspectionFormView.tsx::resolveConflictByDiscarding`) — supprime le brouillon en
conflit d'IndexedDB, l'inspecteur repart d'un formulaire vierge sur la même mission, en
connaissance du dernier événement serveur affiché dans le bandeau de conflit.

Raisons de ne pas construire davantage dans cette passe :

- **Fusion** : nécessiterait un mécanisme de récupération de l'état COURANT du serveur
  (CONTROL ne fait aujourd'hui aucun fetch réseau hors la synchronisation elle-même — la
  liste de missions reste un mock statique, voir passe 1) et une UI de comparaison — un
  chantier significatif, sans preuve qu'il soit nécessaire en usage réel.
- **Arbitrage par un rôle habilité** : nécessiterait un écran/rôle qui n'existe pas dans
  le scope de ce ticket — CONTROL PWA est exclusivement l'app de l'inspecteur (« Missions
  PRO (artisan) » est déjà explicitement hors scope du ticket pour la même discipline :
  ne pas construire un rôle/écran non demandé).
- **Fréquence attendue faible** : un conflit entre deux inspecteurs sur le même
  `work_declaration` en quasi-simultané, tous deux hors ligne, suppose une double
  affectation de mission — pas le mode de fonctionnement attendu (une mission = un
  inspecteur assigné). Construire une UI de fusion pour un cas rare avant d'avoir observé
  sa fréquence réelle serait de la sur-ingénierie non demandée.
- **La garantie non négociable du ticket reste intégralement respectée** par le choix
  actuel : aucun écrasement silencieux. L'abandon est une perte EXPLICITE, décidée et
  assumée par l'inspecteur au moment où il clique, jamais automatique ni silencieuse.

## Condition de réouverture

Si le conflit se révèle fréquent pendant le pilote — mesurable via les logs serveur
(`control_sync_inspection_conflict`, `apps/control/services.py::sync_inspection`,
`correlation_id` en clé de recherche) — ticketiser une itération dédiée : fusion assistée
et/ou écran d'arbitrage pour un rôle habilité. Pas avant, et uniquement sur preuve
d'usage réel, pas par anticipation.

## Ce qui n'a pas besoin d'être revu si cette décision est révisée plus tard

Le mécanisme de DÉTECTION (l'`TrustEvent` le plus récent connu du client comme marqueur
de version, comparé dans la même transaction que l'écriture) n'a pas besoin d'être
retouché pour supporter une résolution plus riche : seule l'ACTION proposée à
l'inspecteur au moment du conflit changerait, jamais la détection elle-même ni la
garantie qu'aucune écriture concurrente n'est silencieusement perdue.
