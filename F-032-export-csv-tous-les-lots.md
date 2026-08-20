# Ticket F-032 — Export CSV pour « Tous les lots » (BUILD)

## Statut
Livré. Branche `feature/frontend-round-2`. Bouton « Exporter en CSV » dans
`apps/build/src/views/AllLotsView.tsx` — explicitement noté « hors scope,
utile mais non bloquant » au ticket 009, jamais construit depuis.

## État des lieux — avant tout code

**Colonnes affichées** : Nom, Bien, Programme, Organisation constructrice,
Jalons déclarés (`déclarés/total`), Avancement (`%`), Réserves ouvertes.

**Filtres/tri déjà en place** : recherche texte (`q`), tri (`ordering`),
filtre « Organisation affectée » (`assigned`) — tous transmis en query
params à `GET /api/build/lots/`, appliqués côté backend.

**Point critique vérifié avant de décider quoi que ce soit** (demande
explicite du ticket) : le tableau `AllLotsView` ne charge JAMAIS toutes
les données côté client — `PAGE_SIZE = 25`, pagination backend réelle
(`state.data.results` = seulement la page courante, `state.data.count` =
total). Exporter `state.data.results` tel quel aurait silencieusement
exporté une page partielle (25 lignes max), exactement ce que le ticket
demande d'éviter.

**Mais aucun nouvel endpoint backend n'est nécessaire pour autant** :
`backend/apps/build/pagination.py::LotPagination` fixe `max_page_size =
100`, et `backend/apps/build/views.py::AllLotsView.get` calcule déjà le
filtre+tri COMPLET en mémoire (bornée en requêtes SQL,
`services.build_lot_rows`, ticket 009) AVANT de paginer — la pagination
n'est qu'une troncature de cette liste déjà calculée. L'endpoint existant
peut donc renvoyer l'intégralité du jeu filtré/trié en un petit nombre
d'appels supplémentaires (`page_size=100`).

## Approche validée par l'utilisateur avant implémentation

Présentée comme un choix explicite avant de coder (troisième option
découverte en creusant, ni « déjà tout chargé » ni « il faut un nouvel
endpoint ») : au clic sur « Exporter en CSV », reparcourir le MÊME
endpoint (même filtre/tri que l'écran, `page_size=100`) jusqu'à épuiser
les pages, puis générer le CSV entièrement côté client. Confirmé par
l'utilisateur, avec deux exigences complémentaires explicites :
1. état de chargement explicite pendant la récupération (jamais un export
   qui semble ne rien faire) ;
2. avertissement AVANT de lancer l'export si le nombre de requêtes
   nécessaires dépasse un seuil raisonnable (10-15), plutôt que de
   laisser l'utilisateur attendre sans explication.

## Ce qui a été construit

- `apps/build/src/export/csv.ts` (+ `csv.test.ts`, 6 tests) : encodage CSV
  générique (RFC 4180 simplifié — guillemets/virgules/sauts de ligne
  échappés uniquement quand nécessaire, `\r\n` en séparateur de ligne).
- `apps/build/src/export/fetchAllLotRows.ts` (+ `fetchAllLotRows.test.ts`,
  5 tests) : reparcourt `GET /api/build/lots/` avec le MÊME filtre/tri que
  l'écran (`baseQuery`, sans `page`) à `pageSize` fourni, jusqu'à
  `next === null`. Aucune erreur avalée silencieusement (une page qui
  échoue fait échouer tout l'export, jamais un CSV partiel).
- `apps/build/src/export/lotsCsvExport.ts` (+ `lotsCsvExport.test.ts`, 7
  tests) : `buildLotsCsv` (colonnes/formatage IDENTIQUES à
  `AllLotsView.tsx` — même ordre, même repli « — », même fraction
  jalons), `buildLotsExportFilename` (`tous-les-lots-YYYY-MM-DD.csv`),
  `downloadCsv` (Blob + ancre `download`, BOM UTF-8 en tête pour Excel
  sous Windows — sans quoi les caractères accentués des noms de
  programmes/biens français seraient corrompus à l'ouverture).
- `apps/build/src/views/AllLotsView.tsx` : bouton « Exporter en CSV » +
  machine à états (`idle`/`confirming`/`exporting`/`error`) — sous le
  seuil, export direct ; au-delà, `AlertBanner` d'avertissement (nombre
  de lots + nombre de requêtes) avec un second bouton explicite
  « Continuer l'export » (même discipline « jamais `window.confirm()` »
  que `BackofficeView`, ticket 021) ; pendant l'export, bouton désactivé
  affichant « Export en cours… » ; en cas d'échec, `AlertBanner` d'erreur,
  bouton réactivé (réessayable), aucun téléchargement partiel déclenché.

## Constantes dédiées à l'export, distinctes de celles de l'écran

`EXPORT_PAGE_SIZE = 100` (le maximum autorisé côté backend) est
DÉLIBÉRÉMENT distinct de `PAGE_SIZE = 25` (celui de l'écran) —
maximise la taille de page pour minimiser le nombre de requêtes
d'export, sans changer la pagination affichée à l'écran.
`EXPORT_REQUEST_WARNING_THRESHOLD = 10` — le nombre de requêtes est
calculé AVANT de lancer le moindre appel réseau d'export, à partir de
`state.data.count` déjà connu (chargement de l'écran) : `Math.ceil(count
/ EXPORT_PAGE_SIZE)`.

## Piège de test — le BOM UTF-8 disparaît d'un texte décodé, par conception

Une première assertion vérifiait le BOM en lisant `blob.text()` et en
comparant `charCodeAt(0)` à `0xFEFF` — échouait systématiquement (premier
caractère lu : `N`, pas le BOM). Cause : un décodeur UTF-8 conforme au
spec (utilisé par `Blob.text()`) retire VOLONTAIREMENT un BOM en tête au
décodage — c'est exactement ce qui le rend invisible pour tout lecteur
correct tout en restant détectable par Excel en amont. Corrigé en lisant
les OCTETS bruts (`blob.arrayBuffer()`) et en vérifiant la séquence de 3
octets `EF BB BF` directement, plutôt que le texte déjà décodé — la seule
façon de vérifier la présence du BOM sans que le test masque
lui-même ce qu'il prétend mesurer.

## Piège d'outillage — `Blob` de jsdom sans `.text()`/`.arrayBuffer()`

Même piège déjà documenté pour CONTROL PWA (ticket 010, passe 1) : le
`Blob` de jsdom n'implémente pas `.text()`/`.arrayBuffer()`. Corrigé en
réassignant `globalThis.Blob` au `Blob` natif de `node:buffer`, SCOPÉ au
describe `downloadCsv` (via `vi.stubGlobal`/`vi.unstubAllGlobals` en
beforeEach/afterEach) — jamais globalement dans `setupTests.ts`, pour ne
pas risquer d'affecter d'autres tests de ce package qui n'en ont pas
besoin.

## Vérification

- **26 nouveaux tests** (6 `csv.test.ts` + 5 `fetchAllLotRows.test.ts` +
  7 `lotsCsvExport.test.ts` + 8 `AllLotsView.test.tsx`) : encodage CSV,
  boucle de pagination (concaténation dans l'ordre, transmission exacte du
  filtre/tri, propagation d'erreur sans absorption silencieuse), export
  direct sous le seuil (toutes les lignes, pas seulement la page à
  l'écran), respect du filtre/tri actif, avertissement au-delà du seuil
  (aucun appel réseau avant confirmation explicite), annulation, état de
  chargement explicite, échec réseau (erreur affichée, rien téléchargé,
  réessayable), nom de fichier daté. **333 tests frontend** (5 packages :
  44+62+54+40+133), zéro régression, `tsc --noEmit` propre.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte
  constructeur réel, 4 lots réels seedés) : tri « Avancement
  (décroissant) » appliqué, export cliqué, CSV intercepté (Blob capturé
  avant téléchargement) — contenu EXACTEMENT identique aux 4 lignes
  affichées à l'écran, même colonnes, même format ; réseau confirmé
  (`read_network_requests`) : un seul appel `GET /api/build/lots/
  ?ordering=-progress_percentage&page=1&page_size=100`, aucun nouvel
  endpoint. Nom de fichier `tous-les-lots-2026-08-20.csv` confirmé.
  Seuil d'avertissement vérifié en simulant un `count` de 1234 (réponse
  `fetch` interceptée côté écran uniquement) : bandeau « Export
  volumineux : 1234 lot(s), 13 requêtes nécessaires. » affiché, ZÉRO
  requête `page_size=100` déclenchée avant confirmation ; « Annuler »
  referme le bandeau sans lancer d'export.

## Explicitement hors scope

- Export dans un format autre que CSV (Excel natif `.xlsx`...) — non
  demandé.
- Export depuis l'écran Exceptions (ticket 009) — ce ticket ne couvre que
  « Tous les lots », seul écran nommé par la demande.
- Un nouvel endpoint backend dédié à l'export — délibérément évité, voir
  section « approche » ci-dessus : l'endpoint existant suffit.

## Dépendances
Aucune — ticket purement frontend, `apps/build` uniquement, zéro
changement backend.
