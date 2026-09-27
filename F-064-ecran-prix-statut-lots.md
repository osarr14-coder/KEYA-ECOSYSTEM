# F-064 — Écran « Lots — prix & statut » (apps/web)

## Contexte

Demande utilisateur : « Ajoute un écran pour le prix et le statut des lots ». Le prix de
vente et le statut commercial d'un lot (`Lot.sale_price`/`Lot.commercial_status`, ticket
B-042) n'étaient modifiables que par appel direct à l'API : aucune des quatre applications
frontend ne les exposait en saisie (vérifié par recherche dans `apps/`).

## Constat d'architecture

- L'assistant `ProgramsView.tsx` (F-049) ne connaît que les lots créés dans sa propre
  session : il ne permet pas de retrouver un lot existant.
- La seule recherche de lots transverse (`GET /api/procurement/admin/lots/`, B-028) est
  propre aux appels d'offres : elle exclut les lots au devis verrouillé, qui restent
  pourtant à commercialiser. Elle ne renvoie ni statut ni prix.

D'où un endpoint de recherche dédié, qui réutilise le mécanisme partagé existant
(`_search_lots_by_name_as_admin`, boucle de bascule RLS par organisation — B-028/B-037)
avec un critère d'inclusion vide, plutôt que de dupliquer la boucle.

## Scope

- **Backend** — `GET /api/programs/admin/lots/?q=` (`CommercialLotSearchView`), gardé par
  `IsAdminKeyimmoOrGestionnaireADV` (même population que la modification d'un lot). Renvoie
  lot, surface, statut, prix, et organisation/programme/bien (`id` + nom).
  `organization.id` est l'`organization_id` qu'attend le `PATCH /api/lots/{id}/`.
- **Frontend** — onglet « Lots — prix & statut » (`/lots`, groupe « Ventes &
  tarification ») : recherche par nom, fiche du lot (contexte + état courant), formulaire
  statut (liste Disponible/Réservé/Vendu) + prix. **Seuls les champs modifiés sont
  envoyés** : renvoyer un prix inchangé ferait refuser (403, B-047) un simple changement de
  statut par un rôle non admin. Le refus du backend est affiché tel quel.

## Hors scope

- **Accès de l'ADV à `apps/web`** : toute l'application reste gardée `admin_keyimmo`
  (`App.tsx`, `hasAdminKeyimmoAccess`). L'API de cet écran accepte déjà l'ADV, mais l'ouvrir
  côté interface implique aussi la redirection après connexion, un filtrage des onglets par
  rôle, et la recherche d'organisation de l'assistant Programmes (réservée à l'admin) —
  ticket séparé si souhaité.
- **Effacer un prix** : le backend traite un champ absent ou vide comme « inchangé »
  (`services.update_lot`) ; un prix ne peut être que remplacé, pas remis à vide.
- **Devise** : aucun écran d'`apps/web` n'affiche de devise (montants bruts de l'API,
  même convention que le grand-livre lot) ; conservé ici.

## Critères d'acceptation

- Un lot existant de n'importe quelle organisation se retrouve par son nom, y compris si
  son devis est verrouillé.
- Statut et prix courants affichés ; modification enregistrée et visible sans recharger.
- Un changement de statut seul n'envoie jamais le prix.
- Un refus du backend (ex. 403 sur le prix) est affiché, l'état affiché reste l'ancien.
- Nouvelle route ajoutée consciemment à la liste de garde des routes
  (`apps/procurement/tests.py`).
- Suites backend et `apps/web` vertes ; vérifié dans un vrai navigateur.
