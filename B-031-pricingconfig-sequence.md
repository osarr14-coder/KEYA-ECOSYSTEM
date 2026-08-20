# Ticket B-031 — Tie-break `sequence` sur `PricingConfig`

## Statut

**Implémenté, testé (3 tests dédiés, suite complète 283 tests verte), documenté —
en attente du feu vert utilisateur pour fusion vers `master`.** Conception tranchée
avec l'utilisateur (points A/B/C/D/E), même discipline que les tickets
012/024/025/026/B-027/B-028/B-029/B-030 : décisions actées avant d'écrire le
code, pas après.

## Origine

Corrige le flake documenté depuis le ticket B-027
(`apps/pricing/tests.py::TestPricingConfigCurrentAndHistory::
test_current_returns_the_latest_rate_per_canal`) : `get_active_rate` dérive le
taux ACTUEL via `PricingConfig.objects.order_by('-created_at').first()`, sans
tie-break — deux enregistrements créés à quelques millisecondes d'écart
(résolution d'horloge, particulièrement visible sur Windows) peuvent être mal
départagés. Risque financier direct : `get_active_rate` alimente
`apps.procurement.services._derive_marge_estimee`, le calcul RÉEL de marge
KEYIMMO (invariant 25.15, CLAUDE.md) — un mauvais taux remontant comme
« actif » fausserait un `Devis` réel.

## Vérification préalable — structure de création, point d'accès unique

**A. `PricingConfig` NE reproduit PAS le même déclencheur que `TrustEvent`,
mais le même remède reste justifié par un risque réel.** Vérifié avant
conception (recherche exhaustive des appelants) :
`apps.pricing.services.create_pricing_config` n'est appelé qu'à UN SEUL
endroit dans tout le code de production
(`apps.pricing.views.PricingConfigCreateView.post`) — jamais chaîné dans une
même transaction sans commit intermédiaire, contrairement à
`_advance_existing_reserve` (la cause réelle du bug 013 bis, qui enchaîne
DEUX `TrustEvent` dans un seul appel). Chaque `PricingConfig` correspond à
une requête HTTP séparée.

Le risque n'en est pas moins réel, par un mécanisme DIFFÉRENT : rien
n'empêche deux requêtes HTTP quasi simultanées (deux onglets admin, deux
utilisateurs `admin_keyimmo`) de créer deux `PricingConfig` pour le même
`(country_pack, canal)` avec un `created_at` trop proche pour être départagé
de façon fiable — aucune contrainte DB n'empêche cette création concurrente,
aucun verrou n'existe. Le flake actuel (trois appels séquentiels rapprochés
dans un même test, sans requête HTTP entre eux) reproduit cette même
ambiguïté de tri par un troisième mécanisme, encore différent des deux
précédents — pas réaliste du rythme humain normal, mais révélateur du même
défaut de fond : **le tri `-created_at` seul n'offre aucune garantie
déterministe, quelle que soit la cause du rapprochement temporel**.

**Point d'accès unique déjà respecté — pas de régression du type ticket
013 bis à corriger.** Recherche exhaustive (`grep -rn "PricingConfig"
apps/*/services.py apps/*/views.py apps/*/tasks.py`, hors `apps/pricing`
lui-même) : aucun autre module ne requête `PricingConfig` directement.
`apps.procurement.services._derive_marge_estimee` passe déjà exclusivement
par `apps.pricing.services.get_active_rate` (jamais un
`PricingConfig.objects.order_by(...)` dupliqué ailleurs) — contrairement à ce
qui avait été trouvé pour `TrustEvent` au ticket 013 bis dans
`apps.build.services._bulk_open_reserves` et
`apps.home.services.compute_milestone_status`/`get_latest_notable_event`.
Aucune correction de ce type n'est donc nécessaire ici — mais une garde
PRÉVENTIVE est ajoutée quand même (décision E) pour empêcher ce genre de
contournement d'apparaître plus tard, jamais découvert a posteriori comme ça
l'a été pour `TrustEvent`.

## Décisions de conception actées

**B. `sequence` — même mécanisme Postgres que `TrustEvent` (migration
`apps/trust/migrations/0004_trustevent_sequence.py`), simplifié.**
`BigIntegerField(unique=True, editable=False)`, alimenté par `nextval()` sur
une séquence Postgres DÉDIÉE (`pricing_pricingconfig_sequence_seq`) — même
garantie qu'un `BIGSERIAL` (ordre d'insertion strict, jamais recalculable
après coup). Migration plus simple que celle de `TrustEvent` :
`pricing_pricingconfig` ne porte AUCUN trigger append-only personnalisé
(seulement RLS, `SELECT`/`INSERT` permissifs, aucune policy `UPDATE`/
`DELETE`) — seul `NO FORCE`/`FORCE ROW LEVEL SECURITY` doit être basculé
temporairement autour du backfill (`UPDATE ... SET sequence = nextval(...)`,
no-op en pratique tant que la table reste petite, correct pour un futur
déploiement avec des données réelles).

**C. `LATEST_FIRST_ORDERING = ('-created_at', '-sequence')`** — même tuple
que `apps.trust.repository.LATEST_FIRST_ORDERING`, utilisé par
`get_active_rate` (dérivation du taux actif). `get_pricing_history` (ordre
ASCENDANT pour l'affichage chronologique) gagne le tie-break symétrique,
`('created_at', 'sequence')` — cohérence complète, pas un correctif partiel :
un historique affiché dans le mauvais ordre entre deux entrées au même
timestamp resterait un bug, même moins grave qu'un mauvais taux actif.

**D. Test de collision FORCÉE, pas un test qui espère reproduire le bug par
hasard.** Exigence explicite de l'utilisateur : le tie-break doit être prouvé
par un scénario qui force le chevauchement — deux `PricingConfig` créés sous
un `django.utils.timezone.now` GELÉ à la MÊME valeur
(`patch('django.utils.timezone.now', return_value=frozen_now)`, même pattern
déjà établi dans ce projet pour ce type de preuve,
`apps/build/tests.py`/`apps/home/tests.py`) — jamais un `sleep`/une
répétition hasardeuse. Le test flaky existant
(`test_current_returns_the_latest_rate_per_canal`) n'est PAS modifié : il
cesse simplement d'être flaky comme effet de bord du tri corrigé, mais il ne
DÉMONTRE pas le tie-break lui-même (ses timestamps réels ont de fortes
chances de rester distincts même après ce correctif) — le nouveau test
déterministe est celui qui apporte la preuve exigée.

**E. Garde préventive par analyse statique, scopée à `PricingConfig`.** Même
famille que `apps.trust.tests.py::
TestNoDirectTrustEventOrderingOutsideRepository` (ticket 013 bis) : scanne le
code source réel de `apps/` (hors migrations/tests) à la recherche de tout
`.order_by(...)` sur un queryset `PricingConfig` contenant `created_at` sans
`sequence`, en dehors de `apps/pricing/services.py`. Aucune violation trouvée
aujourd'hui (décision A) — cette garde protège contre une régression FUTURE,
pas un problème actuel.

## Entités touchées

- `PricingConfig` (`apps/pricing/models.py`) — nouveau champ `sequence`.
- Migration `apps/pricing/migrations/0005_pricingconfig_sequence.py`.
- `apps/pricing/services.py` — `LATEST_FIRST_ORDERING` gagne `-sequence`,
  `get_pricing_history` gagne son tie-break symétrique.
- `apps/pricing/tests.py` — nouveau test de collision forcée + nouvelle
  classe de garde par analyse statique.

## Scope inclus

- Champ `sequence` + migration (décision B).
- `LATEST_FIRST_ORDERING`/`get_pricing_history` corrigés (décision C).
- Test de collision forcée par timestamp gelé (décision D).
- Garde par analyse statique scopée à `PricingConfig` (décision E).

## Explicitement hors scope

- **Aucune contrainte DB empêchant la création concurrente elle-même**
  (deux requêtes HTTP quasi simultanées pour le même `(country_pack, canal)`
  restent toutes les deux acceptées, comme aujourd'hui — `PricingConfig` est
  volontairement append-only, chaque changement de taux est un nouvel
  enregistrement, jamais un remplacement). Ce ticket corrige le DÉPARTAGE
  de « lequel est le plus récent », pas la possibilité même d'une création
  concurrente, qui reste un comportement voulu (historique complet préservé).
- **`LegalPaymentTierTemplate`** — son historique est trié par `version`
  (champ explicite fourni par l'appelant), jamais par `created_at` : aucune
  ambiguïté de ce type ne s'y applique, rien à corriger (voir ticket B-027).
- **`ActiveLegalPaymentTierTemplate`** — pointeur d'état courant, jamais un
  tri sur un historique, hors scope pour la même raison.

## Critères d'acceptation

- [x] `PricingConfig` gagne un champ `sequence` (`BigIntegerField`, unique,
      alimenté par une séquence Postgres dédiée) — même mécanisme que
      `TrustEvent.sequence`.
- [x] `get_active_rate` trie par `(-created_at, -sequence)` — deux
      `PricingConfig` créés avec un `created_at` IDENTIQUE (forcé par
      `timezone.now` gelé) sont départagés correctement par `sequence`, testé
      explicitement dans le pire cas, pas par une exécution normale.
- [x] `get_pricing_history` trie par `(created_at, sequence)` — même
      garantie en ordre chronologique ascendant.
- [x] Le test flaky existant (`test_current_returns_the_latest_rate_per_canal`)
      passe de façon fiable (conséquence du correctif, non modifié lui-même).
- [x] Une garde par analyse statique scopée à `PricingConfig` (même famille
      que `TestNoDirectTrustEventOrderingOutsideRepository`) échoue si un
      futur `.order_by(...'created_at'...)` sur `PricingConfig` apparaît hors
      de `apps/pricing/services.py` sans le tie-break `sequence`.
- [x] Aucune régression sur la suite complète du projet.
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits avant
      de considérer le ticket terminé.

## Notes d'implémentation

**`save()` surchargé sur `PricingConfig`, nécessaire, absent du modèle
initial** — `sequence` n'étant pas un `AutoField` (impossible avec la clé
primaire UUID de ce projet, même contrainte que `TrustEvent`), Django envoie
TOUJOURS une valeur explicite pour ce champ à l'INSERT ; ne pas la poser
explicitement aurait envoyé `NULL` et écrasé silencieusement le `DEFAULT
nextval(...)` posé côté DB par la migration. `PricingConfig.save()` reprend
donc exactement la logique de `TrustEvent.save()` (`nextval()` explicite si
`self.sequence is None`), SANS reprendre sa garde d'immutabilité Python
(`if self.pk and exists(): raise`) — `PricingConfig` n'a jamais eu cette
garde côté Python (seulement RLS), hors scope de ce ticket de l'introduire.

**Migration plus simple que celle de `TrustEvent`, confirmé en écrivant la
migration** : `pricing_pricingconfig` ne porte aucun trigger append-only
personnalisé — seul `NO FORCE`/`FORCE ROW LEVEL SECURITY` a dû être basculé
autour du backfill, pas de `DISABLE`/`ENABLE TRIGGER` (contrairement à
`0004_trustevent_sequence.py`, qui bascule aussi le trigger
`trust_event_no_update`).

**Test de collision forcée — écart avec le pattern `apps/build/tests.py`,
justifié** : ce dernier gèle `timezone.now` pour une SEULE création (la
seconde), reproduisant le déclencheur RÉEL de `TrustEvent` (deux événements
chaînés dans le MÊME appel de service, `_advance_existing_reserve`). Ce
mécanisme ne s'applique pas à `PricingConfig` (décision A : un seul
enregistrement par appel) — les deux tests de ce ticket gèlent
`timezone.now` pour LES DEUX créations (deux appels séparés à
`create_pricing_config`, sous le même bloc `mock.patch`), simulant plutôt
deux requêtes HTTP quasi simultanées. Chaque test vérifie explicitement que
la collision visée a bien eu lieu (`first.created_at == second.created_at`)
avant d'affirmer quoi que ce soit sur le départage — une preuve qui ne
suppose jamais que le `mock.patch` a fonctionné comme prévu.

**Garde par analyse statique** : aucune violation trouvée en l'écrivant —
confirmé, `apps.procurement.services` passe déjà exclusivement par
`get_active_rate`. Contrairement au ticket 013 bis (qui avait TROUVÉ deux
contournements réels dans `apps.build`/`apps.home`), ce ticket n'a rien eu à
corriger sur ce point — seulement à poser la garde préventive.

**Suite de tests** : 3 tests dédiés (2 collisions forcées, 1 garde par
analyse statique). Suite `pricing` complète : 36 tests. Suite complète du
projet : 283 tests, tous verts — le flake historique documenté depuis le
ticket B-027 ne s'est plus manifesté sur cette exécution.
