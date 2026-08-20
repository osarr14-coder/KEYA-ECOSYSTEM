# Ticket F-030 — Administration des paliers légaux de paiement

## Statut
Livré. Branche `feature/frontend-round-2`. Écran fonctionnel réel,
`apps/web/src/views/LegalPaymentTiersView.tsx`, consommant
`LegalPaymentTierTemplate` (ticket B-027, `apps/pricing`) — jamais consommé
côté frontend jusqu'ici. Périmètre `admin_keyimmo` : consultation du
template actif par pays, historique complet, création d'un nouveau
template (brouillon) avec ses paliers, activation.

## Vérification du contrat API — avant tout code, comme d'habitude
Lecture directe de `backend/apps/pricing/{views,serializers,services}.py`
avant d'écrire une ligne de frontend :

- `POST /api/pricing/legal-payment-tier-templates/` — `{country_pack (UUID),
  version (int ≥ 1), steps: [{order (int ≥ 1), code (str ≤ 50), label (str
  ≤ 100), cumulative_cap_percent (decimal, max 5 chiffres/2 décimales),
  allows_progressive_payments (bool)}]}` → 201,
  `LegalPaymentTierTemplateSerializer`. **Garde de non-dépassement** (cœur
  du ticket B-027) : plafonds cumulés STRICTEMENT croissants, dernier
  EXACTEMENT 100 — refusé AVANT toute écriture (aucune ligne créée), en
  400 au format de validation DRF standard (`{champ: ["message"]}`), PAS
  `{detail}`.
- `POST /api/pricing/legal-payment-tier-templates/{id}/activate/` — **aucun
  corps de requête**, `template_id` dans l'URL suffit. Pose
  `activated_by`/`activated_at` sur CE template (jamais réécrits ensuite)
  puis bascule le pointeur d'actif du pays — l'ancien actif, s'il existe,
  n'est JAMAIS modifié (ses propres `activated_by`/`activated_at` restent
  ceux de SA propre activation passée).
- `GET /api/pricing/legal-payment-tier-templates/active/?country_pack_id=...`
  — le template actuellement actif (via le pointeur
  `ActiveLegalPaymentTierTemplate`), **`null` si aucun n'a jamais été
  activé** — jamais dérivé d'un tri sur `activated_at` côté frontend, ce
  serait faux (voir bug de conception évité ci-dessous).
- `GET /api/pricing/legal-payment-tier-templates/history/?country_pack_id=...`
  — TOUS les templates d'un pays (brouillons et activés), triés par
  `version`.

## Piège de conception évité — `activated_at` ≠ « est l'actif courant »
Un template déjà activé puis SUPPLANTÉ par une activation plus récente
garde `activated_by`/`activated_at` posés (jamais effacés, décision D du
ticket B-027) — ces deux champs signifient « a été activé un jour », pas
« est actif MAINTENANT ». `LegalPaymentTierWorkspace` récupère
`activeTemplateId` UNE SEULE FOIS via `GET .../active/` et le transmet en
prop à `HistoryPanel`, qui compare chaque ligne à cet id pour décider
« Actif » vs bouton « Activer » — jamais un tri de l'historique sur
`activated_at`. Testé explicitement (`LegalPaymentTiersView.test.tsx`,
« un template déjà activé mais SUPPLANTÉ... ») : un template supplanté
garde sa provenance d'activation passée ET propose « Activer » (pas
« Actif »), tandis que l'actif courant affiche « Actif ».

## Bug réel trouvé en vérifiant en navigateur — `Response(None)` de DRF rend un corps VRAIMENT vide
`GET .../active/` sans template actif renvoie `Response(None)` côté
backend — **DRF's `JSONRenderer` rend un corps VRAIMENT VIDE dans ce cas,
PAS le littéral JSON `null`** (comportement DRF documenté mais non
intuitif). `apps/web/src/api/client.ts::request()` appelait
`response.json()` sur ce corps vide, levant une `SyntaxError` (« Unexpected
end of JSON input ») — invisible en tests (le mock `jsonResponse()` ne
reproduisait jamais un corps vide), révélé UNIQUEMENT par la vérification
en navigateur réel contre le vrai backend : l'écran affichait « Impossible
de charger le template actif. » (erreur) au lieu de « Aucun template actif
pour ce pays. » pour un pays sans aucun template.

**Corrigé dans `request()` lui-même** (pas un contournement local à
`getActiveLegalPaymentTierTemplate`) : le corps est désormais lu en texte
d'abord (`response.text()`), puis `text === '' ? null : JSON.parse(text)`
— corrige ce cas ET reste rigoureusement équivalent à
`response.json()` pour tous les appelants existants (aucun autre endpoint
de ce projet ne renvoie un corps 200 vide à ce jour). Régression testée
explicitement (`client.test.ts`, nouveau describe « corps de réponse 200
VRAIMENT vide ») avec un mock `emptyBodyResponse()` qui reproduit
fidèlement le piège (son `.json()` lève, comme un vrai `Response` sur un
corps vide) — le mock `jsonResponse()` existant a aussi été corrigé pour
exposer un `.text()` cohérent avec son `.json()`, sinon les 10 tests
préexistants de ce fichier auraient cassé sur le changement de
`request()`.

## Ce qui a été construit
- `apps/web/src/api/types.ts` : `LegalPaymentTierStep`,
  `LegalPaymentTierStepInput` (entrée, sans `id`), `LegalPaymentTierTemplate`
  — miroirs exacts des serializers backend.
- `apps/web/src/api/client.ts` : `createLegalPaymentTierTemplate`,
  `activateLegalPaymentTierTemplate`, `getActiveLegalPaymentTierTemplate`,
  `getLegalPaymentTierTemplateHistory`. `request()` corrigé pour les corps
  200 vides (voir ci-dessus).
- `apps/web/src/api/errors.ts` (NOUVEAU, extrait de `PricingView.tsx`) :
  `formatDrfFieldErrors` — deuxième consommateur atteint avec ce ticket,
  migré hors de `PricingView.tsx` plutôt que dupliqué, même discipline que
  `LEVEL_PROGRESS_FRACTION` (ticket 009 backend).
- `apps/web/src/components/CountryPackSelector.tsx` (NOUVEAU, extrait de
  `PricingView.tsx`) : sélecteur temporaire par UUID manuel, désormais
  partagé entre `PricingView`/`LegalPaymentTiersView` — un `submitLabel`
  paramétrable pour le libellé du bouton, seule différence entre les deux
  usages.
- `apps/web/src/views/LegalPaymentTiersView.tsx` : `ActiveTemplatePanel`,
  `HistoryPanel` (+ `ActivateButton`), `CreateTemplateForm` (liste
  dynamique de paliers — « Ajouter un palier »/« Retirer », au moins un
  requis, cohérent avec la validation backend), `TemplateStepsTable`
  (partagée par le template actif et — si besoin futur — l'historique).
- `apps/web/src/App.tsx` : quatrième onglet « Paliers légaux », même garde
  `admin_keyimmo`, même `TabBar`.
- **`PricingView.tsx` refactorée sans changement de comportement** :
  utilise désormais `CountryPackSelector`/`formatDrfFieldErrors` partagés
  au lieu de ses copies locales — ses 13 tests existants passent
  inchangés après ce refactor (preuve que le comportement observable n'a
  pas bougé).

## Vérification
- **16 nouveaux tests** (`LegalPaymentTiersView.test.tsx`) + **1 nouveau
  test de régression** (`client.test.ts`, corps 200 vide) : sélection
  manuelle du pays, template actif présent/absent/erreur réseau,
  historique vide/brouillon jamais activé (« — » jamais `null` en texte)/
  template supplanté vs actif courant, activation réelle (reload des deux
  panneaux), erreur 400 (template introuvable) avec message backend exact,
  formulaire de création (palier par défaut unique, ajout/retrait, retrait
  désactivé s'il n'en reste qu'un, soumission construit exactement le
  payload attendu), erreur 400 de validation des plafonds avec message
  backend exact. **291 tests frontend** sur les 5 packages
  (44+37+54+40+116), zéro régression, `tsc --noEmit` propre.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte
  `admin_keyimmo` réel, `CountryPack` Sénégal réel) : chargement d'un pays
  sans aucun template (confirme le correctif du bug `Response(None)` —
  « Aucun template actif pour ce pays. » affiché correctement, plus
  d'erreur), création réelle d'un template à 2 paliers (40 % puis 100 %,
  paiements progressifs coché sur le second), activation réelle reflétée
  immédiatement dans les deux panneaux (« Actif » dans l'historique,
  détail complet dans le panneau actif), tentative délibérée d'un template
  dont le dernier palier ≠ 100 refusée avec le message backend EXACT
  (« Le dernier palier doit avoir un plafond cumulé de EXACTEMENT 100
  (reçu : 60.00). »), aucun template fantôme créé. Zéro erreur console
  applicative. Nettoyage complet après coup (process `vite` orphelin tué
  manuellement, conteneur Postgres retiré, volume conservé).

## Explicitement hors scope
- Tout sélecteur réel de pays (même dépendance que `PricingView`, ticket
  F-028 — prérequis backend transmis, toujours pas fusionné).
- Toute résolution de nom pour `created_by`/`activated_by` (UUID bruts) —
  aucun champ `_detail` équivalent côté backend pour ce module.
- Modification/suppression d'un template existant — aucun endpoint
  `PUT`/`PATCH`/`DELETE` côté backend, par design.

## Dépendances
Ticket B-027 (`LegalPaymentTierTemplate`, endpoints consommés ici), ticket
F-028 (`PricingView.tsx`, structure générale de l'écran, `CountryPackSelector`/
`formatDrfFieldErrors` extraits d'ici vers du code partagé), ticket B-028
(modèle de référence pour la future recherche `CountryPack`).
