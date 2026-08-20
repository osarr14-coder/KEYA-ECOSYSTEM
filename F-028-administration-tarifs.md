# Ticket F-028 — Administration des tarifs (PricingConfig)

## Statut
Livré. Branche `feature/frontend-round-2`. Écran fonctionnel réel,
`apps/web/src/views/PricingView.tsx`, consommant `apps/pricing` (ticket
025-backend) — jamais consommé côté frontend jusqu'ici. Périmètre
`admin_keyimmo` : consultation des taux actifs par pays/canal, historique
complet avec provenance, création d'un nouveau taux.

## Vérification du contrat API — avant tout code, comme d'habitude
Lecture directe et complète de `backend/apps/pricing/{views,serializers,
services}.py` avant d'écrire une ligne de frontend :

- `POST /api/pricing/configs/` — `{country_pack (UUID), canal (choix),
  rate (decimal, max 5 chiffres/2 décimales)}` → 201, `PricingConfigSerializer`
  (`id, country_pack, canal, rate, created_by, created_at`). **Aucun
  endpoint `PUT`/`PATCH`/`DELETE` nulle part** pour cette ressource (garde
  de test dédiée côté backend, `TestPricingConfigNoMutationEndpointExists`).
  Erreurs en 400, **format de validation DRF standard** (`{champ:
  ["message"]}`), **PAS** `{detail: "..."}` comme les 409 de
  `apps/procurement` (ticket 027) — voir ci-dessous.
- `GET /api/pricing/configs/current/?country_pack_id=...` — `{canal_1_marge:
  PricingConfigSerializer|null, canal_2_commission: PricingConfigSerializer|null}`,
  toujours les deux clés présentes, `null` si aucun taux n'existe encore
  pour ce canal.
- `GET /api/pricing/configs/history/?country_pack_id=...&canal=...` —
  `PricingConfigSerializer[]`, du plus ancien au plus récent. **L'« ancien
  taux » n'est pas un champ dédié** (confirmé dans la docstring backend de
  `get_pricing_history`) — se lit en comparant deux entrées consécutives de
  la liste, ce que fait `CanalHistoryPanel` (voir ci-dessous). `canal` est
  requis : pas de variante « les deux canaux à la fois » pour cet endpoint,
  contrairement à `current/`.
- `PricingCanal` (`canal_1_marge`/`canal_2_commission`) est un vocabulaire
  de doctrine FIXE (comme `TrustLevel`), pas une configuration par pays —
  codé en dur côté frontend (`CANALS` dans `PricingView.tsx`), même
  raisonnement déjà appliqué à `DevisStatus` (ticket 027).

## Trou découvert — aucun endpoint ne liste les `CountryPack`, transmis comme prérequis backend (RÉSOLU, voir « Levée de la dépendance B-030 » plus bas)
`apps/organizations/urls.py` n'existe toujours pas, et aucun serializer
existant n'expose `CountryPack` (`id`/`label`) — confirmé par grep sur tous
les `serializers.py` du projet. Or les trois endpoints ci-dessus exigent un
`country_pack_id`. Contrairement au trou Lot/Organisation (ticket B-028, des
dizaines d'enregistrements potentiels), un seul `CountryPack` existe
aujourd'hui (Sénégal) — mais la doctrine du projet interdit explicitement
de coder ça en dur (CLAUDE.md, section « Doctrine produit — Visible
Trust » : « Rien n'est codé en dur ce qui doit varier par pays »).

**Décision actée avec l'utilisateur** : documenter ce trou comme prérequis
pour un futur ticket backend — même modèle que B-028/ticket 011 (recherche
FILTRÉE, `GET /api/organizations/country-packs/?q=` ou équivalent, jamais
un dump complet même si un seul résultat existe aujourd'hui), numéro à
attribuer par la session backend (pas de numéro réservé ici pour éviter une
collision avec un autre B-NNN déjà en discussion). En attendant, `PricingView`
fonctionne avec une saisie manuelle d'UUID (`CountryPackSelector`,
`AlertBanner` explicite) — **même schéma temporaire, explicitement marqué
comme tel, que `LotSelector` au tout premier passage du ticket F-027**,
jamais présenté comme une solution définitive.

## Ce qui a été construit
- `apps/web/src/api/types.ts` : `PricingCanal`, `PricingConfig`,
  `CurrentPricingRates` — miroirs exacts des serializers/réponses backend.
- `apps/web/src/api/client.ts` : `getCurrentPricingRates`, `getPricingHistory`,
  `createPricingConfig`. `ApiError` gagne un champ `body?: unknown` (corps
  BRUT de l'erreur) — premier consommateur d'une erreur qui n'a PAS la
  forme `{detail}` (voir `formatPricingApiError` ci-dessous) ; `detail`
  reste inchangé pour tout appelant existant.
- `apps/web/src/views/PricingView.tsx` : `CountryPackSelector` (saisie
  manuelle temporaire), `CurrentRatesPanel` (les deux canaux, `useApiResource`
  + `reloadKey`), `CanalHistoryPanel` (un par canal, colonnes « Ancien
  taux »/« Nouveau taux » dérivées par simple juxtaposition positionnelle de
  deux valeurs déjà authentiques — AUCUNE arithmétique, jamais un calcul
  métier frontend), `CreatePricingConfigForm`.
- `formatPricingApiError` : les erreurs `POST /api/pricing/configs/` sont au
  format de validation DRF standard (`{champ: ["message"]}`), jamais
  `{detail}` — cette fonction lit `ApiError.body`, joint tous les messages
  de tous les champs, et les affiche EXACTEMENT tels que renvoyés par le
  backend (jamais reformulés), avec un message de repli générique
  uniquement si le corps n'est pas exploitable (ex. échec réseau).
- `App.tsx` : troisième onglet « Tarifs », même garde `admin_keyimmo`, même
  `TabBar` que Back-office/Devis (tickets 021/025), jamais un second
  mécanisme d'onglets.

## Vérification
- **13 nouveaux tests** (`PricingView.test.tsx`) : sélection manuelle du
  pays, appels réels vers les 3 endpoints, taux actuel configuré/non
  configuré par canal, historique vide/avec paires ancien-nouveau taux,
  création réussie (reload des deux panneaux), erreurs DRF à un seul champ
  ET à plusieurs champs joints, échec réseau générique. **270 tests
  frontend** sur les 5 packages (44+37+54+40+95), zéro régression,
  `tsc --noEmit` propre.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte
  `admin_keyimmo` réel, `CountryPack` Sénégal réel) : chargement du pays
  (UUID collé à la main), taux actuel réel affiché (12,00 % canal 1, aucun
  taux canal 2), historique réel (une entrée, « — » en ancien taux),
  création d'un nouveau taux (3,50 %) reflétée immédiatement dans « Taux
  actuels » ET dans l'historique (nouvelle ligne « 12,00 % → 3,50 % »,
  provenance réelle), tentative délibérée d'un taux hors limites
  (`99999.99`, dépasse `max_digits=5`) refusée avec le message backend EXACT
  (« Assurez-vous qu'il n'y a pas plus de 5 chiffres au total. »), aucune
  ligne fantôme ajoutée à l'historique. Zéro erreur console applicative (le
  seul log d'erreur réseau observé correspond au 400 volontairement
  déclenché, déjà correctement affiché). Nettoyage complet après coup
  (process `vite` orphelin tué manuellement, conteneur Postgres retiré,
  volume conservé).

## Explicitement hors scope
- ~~Tout sélecteur réel de pays (dépend du futur ticket backend de
  recherche `CountryPack`, transmis comme prérequis).~~ — **résolu, voir
  la section « Levée de la dépendance B-030 » ci-dessus.**
- Modification ou suppression d'un taux existant — aucun endpoint
  `PUT`/`PATCH`/`DELETE` n'existe côté backend, par design (immutabilité de
  l'historique tarifaire).
- `LegalPaymentTierTemplate` (ticket B-027, `apps/pricing`) — sujet distinct
  (paliers légaux de paiement, pas des taux), non demandé par ce ticket, non
  construit ici.

## Dépendances
Ticket 011 (`GET /api/backoffice/users/?q=`, modèle de référence pour la
future recherche `CountryPack`), ticket 021 (`ApiError`, patterns de
rechargement réel après écriture), ticket 025-backend (`apps/pricing`,
`PricingConfig`, endpoints consommés ici), ticket 026-backend
(`_derive_marge_estimee`, seul autre consommateur du taux `canal_1_marge`
dans ce projet, `apps/procurement`), ticket 027/B-028 (`ApiError.detail`,
`DevisView.tsx` — modèle de référence pour la structure générale de l'écran
et pour la future recherche `CountryPack`), **futur ticket backend
(prérequis transmis, numéro à attribuer par la session backend) — recherche
`CountryPack`**.

## Addendum (ticket F-030) — `CountryPackSelector`/`formatPricingApiError` extraits vers du code partagé
`LegalPaymentTiersView.tsx` (ticket F-030) a eu besoin du même sélecteur
temporaire de pays et du même format d'erreur DRF — plutôt que dupliquer,
les deux ont été extraits hors de `PricingView.tsx` : `CountryPackSelector`
vers `apps/web/src/components/CountryPackSelector.tsx` (gagne un prop
`submitLabel`, seule différence entre les deux usages) et
`formatPricingApiError` vers `apps/web/src/api/errors.ts::formatDrfFieldErrors`
(renommée, généralisée — gagne un paramètre `fallback` explicite plutôt
qu'un message codé en dur). `PricingView.tsx` importe désormais ces deux
utilitaires au lieu de ses copies locales — comportement observable
inchangé, vérifié par ses 13 tests existants, verts sans modification après
ce refactor.

## Levée de la dépendance B-030 — sélecteur de pays réel

Suite directe de ce ticket, une fois **B-030** (`GET /api/organizations/
country-packs/`, `admin_keyimmo`, `{id, label, code}[]`, filtré
`is_active=True`, trié par `label`) fusionné dans `master`. Contrat
re-vérifié directement dans `backend/apps/organizations/{views,
serializers}.py` avant tout changement — **aucun paramètre `q`** côté
backend (liste complète, pas une recherche filtrée comme B-028) : `CountryPackSelector`
charge la liste au montage (`useApiResource`, aucune action utilisateur
requise) et applique un filtre textuel PUREMENT CLIENT (label/code,
insensible à la casse) sur cette liste déjà réduite — jamais un second
appel réseau par frappe, puisque le backend n'offre structurellement pas
cette granularité.

**`CountryPackSelector` réécrit** (`apps/web/src/components/
CountryPackSelector.tsx`) : la saisie manuelle d'UUID + bouton « Charger »
(`submitLabel`) disparaît, remplacée par une liste de boutons
`${label} (${code})` sélectionnables directement — même principe que
`LotPicker`/`OrganizationPicker` (`DevisView.tsx`, ticket B-028/F-027), la
sélection EST l'action, pas un formulaire à soumettre. Prop `onLoad`
inchangée de nom mais change de type : `(pack: CountryPackSummary) => void`
au lieu de `(countryPackId: string) => void` — `PricingView`/
`LegalPaymentTiersView` stockent désormais le pays SÉLECTIONNÉ complet
(comme `selectedLot` dans `DevisView`), pas seulement son id, pour afficher
« Pays sélectionné : Sénégal (SN) » au lieu de l'UUID brut.

**Bug TypeScript latent trouvé et corrigé au passage, sans lien avec ce
changement** : `client.test.ts::emptyBodyResponse` (ajouté au ticket F-030
pour le correctif `Response(None)`) échouait `tsc --noEmit` avec
« Conversion... may be a mistake » — un cast `as Response` sur un objet
dont `json: async () => { throw ... }` s'infère en `Promise<never>`, que
TypeScript refuse de considérer « suffisamment proche » de `Response` pour
un simple `as`. Corrigé par un double cast `as unknown as Response`, suivant
exactement la suggestion du compilateur — comportement runtime inchangé,
uniquement une correction de typage statique.

**Vérifié dans un vrai navigateur, avec un vrai backend** (compte
`admin_keyimmo` réel, deux `CountryPack` actifs réels — Sénégal + Côte
d'Ivoire ajoutée spécifiquement pour cette vérification) : liste réelle
des deux pays affichée au chargement, filtre texte « sn » réduisant
correctement la liste à Sénégal seul (Côte d'Ivoire disparaît), sélection
déclenchant les appels `apps/pricing` avec le VRAI UUID résolu par la
liste (confirmé par les requêtes réseau), « Pays sélectionné : Sénégal
(SN) » affiché (jamais l'UUID brut). 5 tests réécrits/ajoutés
(`PricingView.test.tsx`, describe « sélection du pays »), 293 tests
frontend (5 packages : 44+37+54+40+118), zéro régression, `tsc --noEmit`
propre. Cette dépendance était la DERNIÈRE limite documentée du ticket
F-028 — plus aucune saisie manuelle d'UUID nulle part dans cet écran.
