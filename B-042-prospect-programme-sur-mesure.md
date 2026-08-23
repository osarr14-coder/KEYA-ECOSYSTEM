# B-042 — Fondations Prospect / Client & Programme sur mesure (backend)

## Contexte

Discussion produit approfondie sur le workflow prospect → client d'un
programme immobilier. Décisions actées :

- Un « intérêt en amont » (avant inscription) reste un signal marketing
  pur, hors scope technique de ce ticket (pas de modélisation backend
  nécessaire pour un simple capture email).
- Un prospect qui veut acheter un lot existant s'inscrit lui-même et
  choisit son programme en libre-service.
- Un prospect qui veut un bien sur mesure (« client sponsor ») s'inscrit,
  voit des informations suggestives, puis soumet une demande — **jamais**
  il ne crée lui-même de `Program` (le verrou KEYIMMO gatekeeper du
  ticket B-039 reste intact et non négociable).
- Chaque prospect a besoin d'une organisation pour que la mécanique
  RLS-partout du projet (règle non négociable, CLAUDE.md) fonctionne sans
  cas particulier — jamais une organisation partagée entre prospects
  (casserait l'isolation RLS, qui est PAR organisation, pas par
  utilisateur à l'intérieur d'une organisation).

**Découverte en cours de conception** : `POST /api/auth/register/`
(`apps/accounts`) existe déjà — crée un utilisateur + une organisation
individuelle + un `Membership` — mais jamais câblé à aucun écran
frontend, `organization_name` obligatoire, et rôle figé en dur à
`sponsor`. Ce ticket AJUSTE cet endpoint plutôt que d'en créer un
second (voir section dédiée).

## Scope

### 1. `apps/accounts` — inscription publique, rôle au choix

- `RegisterSerializer.organization_name` devient optionnel : vide → nom
  dérivé automatiquement (`Compte personnel — {email}`), jamais affiché
  comme une vraie entreprise, permet à la mécanique organisation/RLS de
  fonctionner sans cas particulier pour un simple client.
- `RegisterSerializer.role` : nouveau champ `ChoiceField`, liste blanche
  stricte `{client, sponsor}` — **jamais** un `CharField` libre : une
  inscription publique (`AllowAny`) ne doit jamais pouvoir accorder un
  rôle opérationnel interne (`admin_keyimmo`, `constructeur`,
  `inspecteur` — tous rattachés par invitation/affectation ailleurs dans
  ce projet). `default='sponsor'` préserve le comportement historique de
  l'endpoint pour tout appelant existant qui n'envoie pas ce champ (seul
  comportement possible avant ce ticket).

### 2. `apps/programs` — `ProgramRequest` (demande de programme sur mesure)

Nouveau modèle, RLS standard (`organization_id = current_org`, même
pattern que `Program`/`Asset`/`Lot`, migration `0002_programs_rls.py`) :

- `organization` : l'organisation du DEMANDEUR (créée à l'inscription),
  jamais dérivée d'un `Program` (qui n'existe pas encore).
- `requested_by`, `description` (texte libre — budget/localisation/type
  de bien, pas de champs structurés pour ce MVP), `status`
  (`en_attente`/`acceptee`/`refusee` — simple champ stocké, PAS un
  `TrustEvent` : une demande commerciale n'est pas un objet de la chaîne
  de confiance chantier, même distinction que `Devis.status`).
- `program` : lien optionnel vers le `Program` éventuellement créé par
  `admin_keyimmo` à partir de cette demande — traçabilité pure, jamais
  automatique. `admin_keyimmo` accepte la demande, puis crée le
  `Program` via le wizard EXISTANT (F-049), inchangé, en désignant
  l'organisation du demandeur comme cible.

**Endpoints** :
- `POST /api/programs/requests/` — n'importe quel utilisateur authentifié
  soumet une demande pour SA PROPRE organisation active (`request.
  organization`, jamais fournie par l'appelant — contrairement aux
  endpoints `admin_keyimmo`).
- `GET /api/programs/requests/mine/` — les demandes de ma propre
  organisation.
- `GET /api/programs/requests/` — TOUTES les demandes, toutes
  organisations confondues, réservé à `admin_keyimmo`. **Mécanisme** :
  boucle de bascule RLS organisation par organisation, EXACTEMENT le
  même mécanisme déjà établi par
  `apps.procurement.services._search_lots_by_name_as_admin` (ticket
  B-028/B-037) — jamais une nouvelle policy RLS large qui accorderait à
  `admin_keyimmo` une visibilité globale (piège déjà rencontré et
  corrigé au ticket B-041, voir migration
  `0009_lot_admin_keyimmo_select.py` : une policy SELECT large avait
  d'abord semblé la solution la plus simple, puis rejetée car elle
  cassait la garantie testée ailleurs qu'un `admin_keyimmo` sans bascule
  RLS explicite ne voit pas les données d'une autre organisation).
- `POST /api/programs/requests/{id}/decide/?organization_id=<id>` —
  accepte/refuse, réservé à `admin_keyimmo`, même bascule RLS explicite
  que `update_program`. Ne crée PAS le `Program` — verrou B-039 intact.

### 3. `apps/programs` — disponibilité commerciale du lot

Deux nouveaux champs sur `Lot`, DISTINCTS du statut de construction
(`TrustLevel`, doctrine Visible Trust) et du statut du devis
(`assigned_organization`/verrouillage, qui répond à « qui construit »,
pas « qui achète ») :
- `commercial_status` (`disponible`/`reserve`/`vendu`, défaut
  `disponible`) — champ stocké classique, comme
  `ProgramCostRepartitionMethod`, pas dérivé d'un `TrustEvent`.
- `sale_price` (`null=True`, aucune valeur inventée pour un lot pas
  encore commercialisé — même discipline que `Lot.surface`, ticket
  B-033) — le prix affiché au CLIENT, jamais à confondre avec
  `Devis.amount` (ce que KEYIMMO paie au constructeur, un tout autre
  acteur).

Écriture réservée à `admin_keyimmo`, même chemin que `name`/`surface`
(`LotViewSet.update` → `services.update_lot`, étendu).

## Hors scope (assumé, pour un futur ticket)

- Aucun écran frontend — ce ticket est backend uniquement, même
  découpage que B-039 (verrou) / F-049 (écran), voir CLAUDE.md.
- Aucune vitrine publique/non authentifiée (fiche programme visible
  sans compte) — chantier à part entière (premier endpoint public du
  projet), à traiter séparément une fois ces fondations posées.
- Aucun champ structuré de matching (typologie, nb pièces, date de
  livraison) — `description` reste un texte libre pour ce MVP.
- Aucun mouvement de fonds réel — `sale_price` est un prix AFFICHÉ,
  jamais un paiement déclenché (cohérent avec les invariants 25.14/25.17
  du modèle économique, toujours « pas encore applicable » dans ce
  projet).
- Aucune UI pour choisir/réserver un lot précis — hors scope, à
  concevoir une fois la disponibilité commerciale posée en base.

## Critères d'acceptation

- `POST /api/auth/register/` sans `role` continue de créer un `sponsor`
  (comportement historique inchangé, tests existants verts sans
  modification).
- `POST /api/auth/register/` avec `role=client` crée un `client`, et
  sans `organization_name` dérive un nom automatique.
- `POST /api/auth/register/` avec un rôle hors liste blanche (ex.
  `admin_keyimmo`) est rejeté (400).
- `ProgramRequest` : un utilisateur crée une demande pour sa propre
  organisation, jamais pour une autre. `admin_keyimmo` liste TOUTES les
  demandes (plusieurs organisations), un membre ordinaire ne voit que
  les siennes. `admin_keyimmo` accepte/refuse ; le statut change,
  aucun `Program` n'est créé automatiquement.
- `Lot.commercial_status`/`sale_price` : lecture ouverte (comme le
  reste de `Lot`), écriture réservée à `admin_keyimmo` — un membre
  ordinaire ne peut pas les modifier (testé, même gabarit que
  `TestProgramAssetLotAdminGatekeeping`, ticket B-039).
- Suite complète backend verte, aucune régression.
