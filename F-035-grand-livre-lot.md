# Ticket F-035 — Grand-livre de coûts par lot (canal 1)

## Statut
Livré (branche `feature/frontend-round-2`).

## Contexte

Écran fonctionnel réel consommant `LotLedger` (ticket B-035 backend) —
jamais consommé côté frontend jusqu'ici. Contrat API vérifié directement
dans `backend/apps/procurement/{models,services,views,serializers}.py`
avant tout code, jamais supposé depuis la description initiale du ticket.

## État des lieux — trois découvertes qui ont changé le périmètre

**1. `LotBcCharge` (ticket B-036) n'existe pas côté backend.** Vérifié dans
`models.py` (commentaire explicite du modèle `LotLedger` : *"SANS les
charges bureau de contrôle, voir ticket B-036 à venir"*) et confirmé par
`git log` (aucun commit B-036 dans l'historique). Aucune liste de charges
BC n'est donc affichable — la description initiale du ticket supposait à
tort que B-036 était déjà construit.

**2. « Construction courante » n'est pas exposée comme poste isolé.**
`GET /api/procurement/lot-ledgers/{lot_id}/margin/` renvoie uniquement le
nombre final déjà calculé (`{margin: "..."}`), jamais sa décomposition. La
recalculer côté frontend (`devis.amount + Σ écarts`) violerait la doctrine
« aucun calcul frontend, jamais recalculé » déjà appliquée strictement
partout ailleurs dans ce projet — `get_lot_ledger_margin` documente
elle-même `get_construction_amount` comme seule source de vérité, même
famille que `get_active_control_office_rate` (ticket B-034).

**Décision validée avec l'utilisateur avant implémentation** : ni la
construction courante, ni les charges BC ne sont affichées comme postes du
grand-livre dans ce ticket — les deux sont documentées comme dépendances
backend BLOQUANTES, **explicitement mentionnées dans l'interface
elle-même** (jamais un silence), même pattern que B-028/B-030 pour de
précédents tickets frontend. **Nouveau ticket backend à cadrer séparément**
(numéro à déterminer côté session backend) : étendre l'endpoint de marge
(ou en exposer un nouveau) pour renvoyer la décomposition complète —
`prix_client`, `foncier_alloue`, `be_alloue`, `construction_courante`
(devis + chaîne `DevisAjustement`), somme des charges BC, marge résultante
— plutôt que la seule marge finale actuelle. Toutes ces valeurs sont déjà
calculées côté backend, seulement jamais exposées ensemble dans une seule
réponse structurée.

**3. Le lien avec `DevisView` n'est pas juste pratique — il est
nécessaire.** `search_lots_as_admin` (ticket B-028) exclut les lots DÉJÀ
verrouillés de ses résultats de recherche. Une fois un devis verrouillé,
ce lot ne réapparaît plus jamais dans `LotPicker`. Le seul endroit où ce
lot reste accessible est l'état déjà sélectionné dans `DevisView`
(`selectedLot`, jamais re-cherché après verrouillage) — un nouvel onglet
avec sa propre recherche de lot n'aurait donc jamais pu trouver ce lot.

**Task ALERT (ticket 024) — vérifié, aucun rapport avec ce ticket.**
`create_task_for_devis_ajustement_refuse` (`apps/tasks/services.py`) ne se
déclenche que sur un `DevisAjustement` **refusé** (écart au-delà de la
marge du DEVIS), jamais sur une marge de GRAND-LIVRE négative — B-036
n'existe pas, aucun mécanisme d'alerte n'est lié à `LotLedger`. Et de toute
façon, `apps/web` (où vit `admin_keyimmo`) ne consomme pas
`GET /api/me/tasks/` — seul `apps/home` le fait. Conclusion : zéro risque
de duplication d'affichage, mais aussi zéro mécanisme existant à
réutiliser — la clarté visuelle de la marge négative doit vivre
entièrement dans l'écran du grand-livre lui-même.

## Implémentation

**`LotLedgerPanel.tsx`** (nouveau fichier, pas dans `DevisView.tsx` —
déjà 569 lignes) — monté depuis `DevisView.tsx::DevisListPanel`, JAMAIS un
nouvel onglet, uniquement une fois `lotAlreadyLocked` (au moins un devis
`devis_verrouille` dans la liste déjà chargée).

- `CreateLotLedgerForm` — saisie `prix_client` seule (`foncier_alloue`/
  `be_alloue` dérivés backend, jamais transmis). Erreurs via
  `formatDrfFieldErrors` (`apps/web/src/api/errors.ts`, déjà partagé par
  `PricingView`/`LegalPaymentTiersView`) — gère À LA FOIS les 409 métier
  (`LotDevisNotLockedError`/`LotLedgerAlreadyExistsError`/
  `NoProgramCostError`/`LotMissingSurfaceError`, `ApiError.detail`) ET les
  400 DRF de validation (`ApiError.body`), messages backend EXACTS.
- `LotLedgerDetail` — prix client / foncier alloué / BE alloué (valeurs
  API directes, `data-testid` dédiés). Mention EXPLICITE des deux
  dépendances backend bloquantes (construction courante, charges BC) —
  jamais un silence.
- `LotLedgerMargin` — composant SÉPARÉ (l'endpoint `/margin/` 404 tant
  qu'aucun grand-livre n'existe, contrairement au détail qui renvoie
  `null` ; n'est donc appelé qu'une fois l'existence déjà confirmée par le
  parent). Marge négative → `AlertBanner` (réutilise le token ambre
  `semanticColors.alert` existant — décision explicite, cohérent avec
  l'usage déjà établi partout dans ce projet pour tout état qui demande
  attention, pas de nouveau token « danger » introduit). `isNegative` est
  une simple lecture de SIGNE sur une valeur déjà calculée par le backend
  — pas un calcul métier (même principe que vérifier `ecart < 0` sur un
  `DevisAjustement` déjà reçu).

**`apps/web/src/api/client.ts`** — `getLotLedger`, `getLotLedgerMargin`,
`createLotLedger`. **`apps/web/src/api/types.ts`** — interface `LotLedger`
(miroir exact de `LotLedgerSerializer`).

## Tests

10 tests dédiés (`LotLedgerPanel.test.tsx`) : chargement/erreur avec
retry, formulaire de création (soumission, 409 exact, 400 DRF exact),
détail affiché sans calcul, mention explicite des deux dépendances
bloquantes, marge positive (texte simple) vs négative (`AlertBanner`,
jamais confondues), erreur de chargement de la marge distincte du détail.
2 tests d'intégration (`DevisView.test.tsx`) : le panneau n'apparaît PAS
tant qu'aucun devis n'est verrouillé, apparaît et appelle
`getLotLedger(lotId, organizationId)` une fois verrouillé — 5 tests
préexistants de ce même fichier (section « devis verrouillé ») adaptés
pour fournir un mock `getLotLedger` explicite, sans quoi le panneau
nouvellement monté affichait son propre bandeau d'erreur générique
(mock par défaut « not mocked »), créant un second bouton « Réessayer »
ambigu pour `getByRole`.

**437 tests frontend** (5 packages : 64+75+73+55+170), zéro régression
(2 exécutions consécutives propres de la suite complète), `tsc --noEmit`
propre.

## Vérification en navigateur réel

**Pas de vérification en navigateur réel, décision assumée** — aucun
backend/Docker Postgres n'est démarré dans cet environnement au moment de
ce ticket (`docker ps`/port 8000 vérifiés vides), et ce worktree est
explicitement frontend-only (voir CLAUDE.md, en-tête du projet). Monter
l'infrastructure backend complète (Docker, migrations, seed
`PricingConfig`/`ProgramCost`/`Devis` verrouillé) pour cette seule
vérification aurait été un détour disproportionné par rapport à la
couverture automatisée déjà obtenue (12 tests, incluant les messages
d'erreur backend EXACTS reproduits via `ApiError`). Contrairement aux
tickets précédents (F-027 notamment) qui ont pu s'appuyer sur un backend
déjà actif dans leur session, aucun n'était disponible ici.

## Dépendances
**Bloquante, transmise à la session backend** : extension de l'endpoint
de marge (ou nouveau endpoint) pour exposer la décomposition complète
(construction courante, charges BC) — voir « État des lieux », point 2,
ci-dessus. Sans elle, l'écran reste volontairement incomplet, documenté
comme tel dans l'interface elle-même.
