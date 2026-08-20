# Ticket F-035 — Grand-livre de coûts par lot (canal 1)

## Statut
Livré (branche `feature/frontend-round-2`). **Corrigé après livraison
initiale** — voir « Correction post-fusion » ci-dessous : le point 1 de
l'état des lieux (`LotBcCharge` inexistant) était FAUX, causé par une
branche non synchronisée avec `master` au moment de l'implémentation.

## Contexte

Écran fonctionnel réel consommant `LotLedger` (ticket B-035 backend) —
jamais consommé côté frontend jusqu'ici. Contrat API vérifié directement
dans `backend/apps/procurement/{models,services,views,serializers}.py`
avant tout code, jamais supposé depuis la description initiale du ticket.

## État des lieux — trois découvertes qui ont changé le périmètre

**1. `LotBcCharge` (ticket B-036) n'existe pas côté backend — CE CONSTAT
ÉTAIT FAUX, voir « Correction post-fusion » plus bas.** Au moment de cette
vérification, `models.py` portait bien le commentaire *"SANS les charges
bureau de contrôle, voir ticket B-036 à venir"* et `git log` ne montrait
aucun commit B-036 — mais cette branche n'avait en réalité jamais
synchronisé `master`, qui avait DÉJÀ fusionné B-036 (commit `5de9293`)
AVANT le début de ce ticket. La vérification a donc porté sur un instantané
périmé du backend, pas sur son état réel.

**2. « Construction courante » n'est pas exposée comme poste isolé.**
`GET /api/procurement/lot-ledgers/{lot_id}/margin/` renvoie uniquement le
nombre final déjà calculé (`{margin: "..."}`), jamais sa décomposition. La
recalculer côté frontend (`devis.amount + Σ écarts`) violerait la doctrine
« aucun calcul frontend, jamais recalculé » déjà appliquée strictement
partout ailleurs dans ce projet — `get_lot_ledger_margin` documente
elle-même `get_construction_amount` comme seule source de vérité, même
famille que `get_active_control_office_rate` (ticket B-034).

**Décision validée avec l'utilisateur avant implémentation (livraison
initiale, avant correction)** : ni la construction courante, ni les
charges BC n'étaient affichées comme postes du grand-livre — les deux
documentées comme dépendances backend BLOQUANTES, explicitement
mentionnées dans l'interface elle-même. **Seule la construction courante
reste réellement bloquante après correction** (voir « Correction
post-fusion ») : `GET .../margin/` continue de ne renvoyer que le nombre
final, jamais sa décomposition. Un futur ticket backend pourrait étendre
cet endpoint pour exposer `construction_courante` isolément — non
demandé/cadré à ce jour, la marge affichée dans ce ticket en reste déjà
nette (backend), ce qui suffit fonctionnellement.

**3. Le lien avec `DevisView` n'est pas juste pratique — il est
nécessaire.** `search_lots_as_admin` (ticket B-028) exclut les lots DÉJÀ
verrouillés de ses résultats de recherche. Une fois un devis verrouillé,
ce lot ne réapparaît plus jamais dans `LotPicker`. Le seul endroit où ce
lot reste accessible est l'état déjà sélectionné dans `DevisView`
(`selectedLot`, jamais re-cherché après verrouillage) — un nouvel onglet
avec sa propre recherche de lot n'aurait donc jamais pu trouver ce lot.

**Task ALERT (ticket 024) — vérifié à nouveau après correction, conclusion
INCHANGÉE malgré B-036.** `create_task_for_devis_ajustement_refuse`
(ticket 024) ne se déclenche toujours que sur un `DevisAjustement`
**refusé** — mais B-036 a bien ajouté un SECOND mécanisme distinct :
`record_bc_charge_for_mission` déclenche une alerte `ALERT` sur marge
négative de GRAND-LIVRE, en réutilisant exactement le mécanisme du
ticket 024 (`_get_or_create_task`), `subject = LotLedger`. Conclusion
inchangée malgré cette découverte : `apps/web` (où vit `admin_keyimmo`)
ne consomme toujours pas `GET /api/me/tasks/` — seul `apps/home` le
fait — donc cette alerte, comme celle du ticket 024, reste invisible pour
`admin_keyimmo` aujourd'hui. Zéro risque de duplication d'affichage avec
`LotLedgerMargin` (ce ticket), mais un signal clair qu'un futur ticket
« Task Inbox pour admin_keyimmo » aurait une vraie valeur.

## Correction post-fusion : `LotBcCharge` existe bien (ticket B-036)

Signalé par l'utilisateur après la livraison initiale : `master` avait
fusionné B-036 (commit `5de9293`) AVANT le début de ce ticket F-035, mais
cette branche (`feature/frontend-round-2`) était restée synchronisée sur
un point antérieur (`5b90a23`) et n'avait jamais refait `git fetch`/`merge`
depuis. Le contrat backend « vérifié directement dans le code » l'a donc
été sur un instantané périmé — le code lu était réel, mais pas à jour.

**Vérifié après `git fetch origin master` + `git merge`** : `LotBcCharge`
existe bel et bien (`backend/apps/procurement/models.py`), avec :
- `GET /api/procurement/lot-ledgers/{lot_id}/bc-charges/?organization_id=...`
  — historique complet, liste VIDE (jamais 404) si aucune charge. Champs :
  `id, organization, lot, mission, jalon_type, montant,
  is_global_reference, created_by, created_at`.
- `get_lot_ledger_margin` intègre déjà `- Σ LotBcCharge.montant` dans sa
  formule — **`LotLedgerMargin` (déjà livré) n'a nécessité AUCUN
  changement de code**, la marge affichée reflète désormais automatiquement
  les charges dès qu'elles existent, sans rien recalculer côté frontend.
- `LotBcCharge.lot` est une **FK DIRECTE vers `Lot`, PAS vers `LotLedger`**
  — les charges s'accumulent dès la première `InspectionMission` sur ce
  lot, indépendamment de l'existence du grand-livre. Décision de
  conception backend explicite (« une charge BC doit TOUJOURS pouvoir
  être enregistrée, indépendance du contrôle »).

**Correctif appliqué** : nouveau composant `LotBcChargesPanel` dans
`LotLedgerPanel.tsx`, rendu comme SIBLING de `CreateLotLedgerForm`/
`LotLedgerDetail` (jamais imbriqué dans l'un ou l'autre) — reflète
fidèlement le fait que les charges sont indépendantes de l'existence du
`LotLedger`, donc visible aussi bien AVANT qu'APRÈS sa création. Liste
chaque charge telle que reçue (jalon, montant, type — forfait global ou
tarif fixe, date) ; **aucun total affiché** : la somme des charges est
déjà intégrée à la marge disponible mais n'est exposée par aucun endpoint
comme valeur isolée — la recalculer ici aurait été un calcul frontend, même
limite que la construction courante (voir plus haut, toujours réelle).

**Nouveau client/type** : `apps/web/src/api/client.ts::getLotBcCharges`,
`apps/web/src/api/types.ts::LotBcCharge` (miroir exact de
`LotBcChargeSerializer`).

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
  API directes, `data-testid` dédiés). Mention EXPLICITE de la dépendance
  backend restante (construction courante non exposée isolément) — jamais
  un silence.
- `LotBcChargesPanel` — historique des charges BC (voir « Correction
  post-fusion » ci-dessus), sibling toujours visible, indépendant de
  l'existence du grand-livre.
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
`createLotLedger`, `getLotBcCharges`. **`apps/web/src/api/types.ts`** —
interfaces `LotLedger`/`LotBcCharge` (miroirs exacts des serializers).

## Tests

14 tests dédiés (`LotLedgerPanel.test.tsx`) : chargement/erreur avec
retry, formulaire de création (soumission, 409 exact, 400 DRF exact),
détail affiché sans calcul, mention explicite de la dépendance restante
(construction courante), marge positive (texte simple) vs négative
(`AlertBanner`, jamais confondues), erreur de chargement de la marge
distincte du détail, **4 tests dédiés aux charges BC** (état vide, visible
même sans grand-livre existant, liste chaque charge sans total calculé,
erreur distincte avec retry). 2 tests d'intégration (`DevisView.test.tsx`)
: le panneau n'apparaît PAS tant qu'aucun devis n'est verrouillé, apparaît
et appelle `getLotLedger(lotId, organizationId)` une fois verrouillé.

**Piège de test rencontré DEUX FOIS, même classe** : à chaque nouvel appel
API introduit par `LotLedgerPanel` (`getLotLedger`, puis `getLotBcCharges`
lors de la correction), les tests préexistants qui montent ce panneau sans
mocker le nouvel appel affichaient un bandeau d'erreur générique
supplémentaire (mock par défaut « not mocked »), créant un second bouton
« Réessayer » ambigu pour `getByRole`. Corrigé la première fois en
patchant 5 tests individuellement (`getLotLedger`) ; corrigé la seconde
fois plus robustement en ajoutant un mock par défaut neutre directement
dans les helpers `renderPanel`/`renderView` (`getLotBcCharges: vi.fn().
mockResolvedValue([])`) — évite qu'un TROISIÈME appel futur ne reproduise
le même piège test par test.

**441 tests frontend** (5 packages : 64+75+73+55+174), zéro régression
(2 exécutions consécutives propres de la suite complète après fusion de
`master`), `tsc --noEmit` propre.

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
**Non bloquante** : une future extension de l'endpoint de marge pour
exposer `construction_courante` isolément resterait utile (voir
« État des lieux », point 2), mais n'empêche pas ce ticket de fonctionner
correctement — la marge affichée reste déjà nette de ce terme (calcul
backend). Aucune dépendance bloquante restante côté charges BC, intégrées
dans ce même ticket après la correction post-fusion.

**Leçon générale pour ce projet, au-delà de ce ticket seul** : avant de
conclure qu'une fonctionnalité backend « n'existe pas encore » (candidat à
devenir une dépendance transmise à une autre session), vérifier d'abord
que la branche locale est à jour avec `master` (`git fetch`/`git log
HEAD..origin/master`) — un constat basé sur un instantané périmé peut
recadrer un ticket entier à tort, comme ici.
