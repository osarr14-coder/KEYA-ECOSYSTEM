# Ticket 026 — Statut « gagnant » dans la maquette Devis/Appels d'offres

## Statut
Livré. Branche `feature/frontend-round-2`. Suite directe du ticket 025 : une fois le
ticket 024 (réconciliation devis/ajustement) fusionné dans `origin/master`, complète la
maquette `DevisAppelOffreMockup.tsx` avec le comportement réel du statut « gagnant »
gaté côté candidat — vérifié dans le code backend avant d'écrire quoi que ce soit, comme
demandé.

## Contexte
Au ticket 025, la maquette marquait explicitement le statut « gagnant » comme absent,
« à câbler une fois le ticket 024 fusionné » — ticket 024 backend en cours ailleurs à
l'époque. Entre-temps, `origin/master` a avancé deux fois (ticket 022 fusionné avant même
le début du ticket 025, puis ticket 024 fusionné PENDANT le ticket 025) sans que ce
worktree ne les récupère à chaque fois immédiatement — synchronisé ici via `git merge
origin/master`, conflit résolu (uniquement `CLAUDE.md`, sections indépendantes).

## Vérification du contrat API — avant tout code, comme d'habitude
Lecture directe de `backend/apps/procurement/{services,serializers,views}.py` (jamais
supposé à partir du seul fichier ticket) :
- `DevisAdminSerializer` (`GET /api/procurement/admin/lots/{lot_id}/devis/`) expose
  `amount`, `marge_estimee`, et `status` — le statut RÉEL
  (`services.get_devis_status`), **jamais gaté** : un admin voit `devis_verrouille` dès
  l'instant du verrouillage, avant toute réconciliation.
- `DevisCandidateSerializer.get_status` (`GET /api/procurement/my-candidatures/`)
  appelle `services.get_candidate_visible_devis_status`, **distincte** de la précédente :
  reste `candidat` tant qu'aucun `DevisAjustement` n'existe pour le devis, même
  verrouillé. Un ajustement REFUSÉ (409) ne crée jamais de ligne — ne peut donc jamais,
  à tort, faire apparaître le statut gagnant.
- `GET/POST /api/procurement/devis/{id}/ajustements/` — `POST` renvoie
  `DevisAjustementAdminSerializer` (`id, devis, organization, ecart, created_by,
  created_at`) + `marge_resultante` ajouté à la réponse.

## Décision de conception — deux indicateurs distincts, jamais fusionnés
La maquette représente désormais DEUX statuts pour une ligne de devis verrouillée,
séparément :
1. `DevisStatusIndicator` (inchangé depuis le ticket 025) — le statut RÉEL admin
   (« Verrouillé »), toujours exact.
2. `CandidateVisibleStatusNote` (nouveau) — ce que voit ACTUELLEMENT le candidat
   (« Gagnant » ou « encore Candidat »), gaté par la présence d'au moins un
   `DevisAjustement`.

Les deux peuvent légitimement afficher des informations différentes pour la MÊME ligne,
au MÊME instant — c'est précisément le sujet du ticket 024. Les fusionner en un seul
indicateur aurait caché cette nuance, contraire à l'objectif même de la maquette (montrer
à l'admin ce qui reste à faire pour que son candidat voie enfin qu'il a gagné).

## Données mockées — trois cas couverts délibérément
- **Lot A12** (devis verrouillé + 2 ajustements, un favorable puis un défavorable) → vue
  candidat = « Gagnant ». Sert aussi à illustrer le cumul SIGNÉ (ticket 024, point A) :
  la marge résultante de chaque ligne reflète le cumul, jamais `marge_estimee` seule.
- **Lot C07** (devis verrouillé, AUCUN ajustement) → vue candidat = encore « Candidat »
  — cas ajouté spécifiquement pour ce ticket, absent du 025, précisément pour prouver que
  le verrouillage seul ne suffit jamais.
- **Lot B03** (devis non verrouillé) → aucune vue candidat affichée (le gating ne
  concerne que les devis verrouillés).

Toute valeur affichée (montants, marge résultante) reste une chaîne PRÉ-FORMATÉE codée
en dur dans `MOCK_LOTS` — aucun calcul fait dans ce fichier, même sur des données
fictives, même discipline « aucun calcul frontend » que le reste du projet, sans
exception pour une maquette.

## Bug pré-existant trouvé et corrigé en relançant la suite complète après le merge
Sans lien avec le contenu de ce ticket — révélé en confirmant l'absence de régression
après le merge de `origin/master` (`apps/control-pwa` n'a pourtant reçu aucun changement
de ce merge).

**Symptôme** : `InspectionFormView.test.tsx`, describe "un conflit (ticket 010 passe
2)", échouait de façon intermittente (~50 % des exécutions en suite complète, jamais en
isolant le seul fichier) — le brouillon en conflit, seedé juste avant `render()`, n'était
pas retrouvé par le composant au montage.

**Cause 1, trouvée et corrigée** : ce fichier avait sa PROPRE boucle de nettoyage locale
(`indexedDB.deleteDatabase()` jamais attendu) au lieu du helper partagé
`clearIndexedDB()` (le correctif exact du ticket 012 pour ce piège) — `MissionsListView.
test.tsx`/`App.test.tsx` l'utilisaient déjà, seul ce fichier avait divergé. Corrigé en
adoptant le helper partagé.

**Cause 2, trouvée en creusant plus loin (le correctif seul n'a pas suffi)** :
`db.put(...)`/`db.delete(...)` (raccourcis `idb` utilisés dans `saveDraft`/`patchDraft`/
`deleteDraft`, `apps/control-pwa/src/db/repository.ts`) résolvent à la réussite de la
REQUÊTE, pas à la complétion de la TRANSACTION (`tx.done`) — fermer la connexion
immédiatement après pouvait, sous `fake-indexeddb` en particulier, interrompre la
validation de la transaction avant qu'une lecture sur une NOUVELLE connexion, ouverte
juste après (le montage d'`InspectionFormView` recharge son brouillon via `Promise.all`
dans son `useEffect`), ne la voie. Même classe de piège que celui déjà documenté au
ticket 018 (IndexedDB résout via de vraies tâches de la file d'attente, jamais
seulement des microtasks). Corrigé en construisant explicitement la transaction et en
attendant `tx.done` avant `db.close()`, dans les trois fonctions d'écriture concernées.

**Résultat, honnêtement rapporté** : fréquence d'échec réduite très fortement (7/7
exécutions isolées propres, 3/4 exécutions en suite complète propres après ce second
correctif — contre ~50 % avant), mais UNE exécution en suite complète a encore échoué
juste après le premier correctif (avant le second). Compte tenu du temps déjà investi
sur un problème d'infrastructure de test préexistant, sans lien avec le sujet réel de ce
ticket, et de l'amélioration déjà mesurée, cette investigation s'arrête ici — documenté
comme dette de fiabilité résiduelle, pas comme un problème caché ou classé clos à tort.
Si le flake réapparaît, la piste suivante à explorer serait le comportement de
`fake-indexeddb` lors d'ouvertures de connexions concurrentes juste après une suppression
de base (`clearIndexedDB` → `saveDraft` → deux lectures simultanées au montage).

## Vérification
- **250 tests frontend** sur les 5 packages (web 75 dont 6 nets nouveaux/modifiés,
  design-system 44, home 40, build 37, control-pwa 54) — tous verts après les deux
  correctifs. `tsc --noEmit` propre.
- **Suite backend complète relancée après le merge** : 220 tests, 0 échec (confirme
  qu'aucune régression n'a été introduite par la fusion du ticket 024, notamment côté
  `apps/tasks`, également modifié par ce ticket).
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte admin réel) : les
  trois lots mockés s'affichent avec les statuts attendus — Lot A12 montre « Verrouillé »
  (admin) + « Vue candidat : « Gagnant » » + l'historique complet des 2 ajustements
  (écarts favorable/défavorable, marge résultante cumulée) ; Lot C07 montre
  « Verrouillé » + « Vue candidat : encore « Candidat » » + « Aucun ajustement
  enregistré » ; Lot B03 (non verrouillé) n'affiche aucune vue candidat. Zéro appel
  réseau vers un endpoint `procurement` (confirmé via `read_network_requests`), zéro
  erreur console. Nettoyage complet après coup (serveurs arrêtés, conteneur Postgres
  retiré, aucun résidu).

## Explicitement hors scope
- Câblage réel de la maquette à l'API (toujours une maquette — aucun appel réseau
  n'existe dans ce fichier, par construction).
- Formulaire réel de saisie d'un ajustement (bouton désactivé, comme les autres actions
  de cette maquette depuis le ticket 025).
- Investigation plus poussée du flake IndexedDB résiduel (voir section dédiée) —
  documenté comme dette, pas repris ici.

## Dépendances
Ticket 012 (`clearIndexedDB`, correctif de référence pour la cause 1 du flake), ticket
018 (précédent exact pour la cause 2 du flake — IndexedDB résout via de vraies tâches),
ticket 022 (`Devis`, statut réel `get_devis_status`), ticket 024 (`DevisAjustement`,
`get_candidate_visible_devis_status`, contrat API de ce ticket), ticket 025 (maquette
`DevisAppelOffreMockup`, base de ce ticket).
