# B-040 — Détection de documents dupliqués à l'upload

## Contexte

Gate 3, item 7 (`docs/gate3-classement-angles-morts.md`) classe la
« modération et qualité des données » en SHOULD — touche directement la
doctrine Visible Trust : un doublon non signalé (preuve réutilisée d'un
autre contexte) sape la promesse du produit. Décision validée avec Assane
Sarr : scope réduit aux **doublons exacts** (même contenu binaire) — la
détection de falsification (montage, faux tampon) demanderait de l'analyse
d'image/ML, hors de portée ici, à traiter séparément si besoin un jour
(RESEARCH REQUIRED, pas ce ticket).

Le champ `Document.hash` (sha256 du fichier tel qu'uploadé, ticket 004)
existe déjà mais n'est aujourd'hui jamais exploité pour comparer les
documents entre eux — seulement gardé comme ancrage de chaîne de custody.

## Décisions validées

1. **Action à l'upload** : autorisé + signalé, jamais bloqué. Un doublon
   peut être un usage légitime (réutilisation volontaire d'un justificatif) ;
   le cacher ou le refuser contredirait la doctrine Visible Trust (ne jamais
   rien cacher, laisser la donnée parler).
2. **Périmètre de comparaison** : toute l'organisation, tous jalons/preuves
   confondus — pas seulement le même jalon/déclaration de travaux. Détecte
   la réutilisation d'une preuve d'un autre contexte, pas seulement au sein
   du même jalon.

## Scope

- `apps/evidence/models.py` — `Document.duplicate_of` : FK vers `self`,
  nullable, `on_delete=SET_NULL`, `editable=False`. Calculé une seule fois à
  la création, jamais recalculé après (même discipline que `hash`/`source`/
  `captured_at` — un champ de provenance, pas un état qui peut changer).
- `apps/evidence/services.create_document` — après calcul du hash, avant la
  création : cherche le plus ancien `Document` de la même organisation
  portant le même hash (`order_by('created_at').first()`) ; s'il existe, il
  devient `duplicate_of`. Toujours le plus ancien de la chaîne, jamais le
  doublon immédiatement précédent — un 3e upload identique pointe donc vers
  l'original, pas vers le 2e.
- `apps/evidence/serializers.DocumentSerializer` — expose `duplicate_of`
  (id, `null` si aucun doublon détecté) en lecture seule.
- Migration Postgres pour la nouvelle colonne (RLS déjà en place au niveau
  table, `evidence_document` — un FK vers la même table n'a besoin d'aucune
  policy supplémentaire).

## Hors scope

- Tout écran frontend (bannière d'alerte à l'affichage d'un doublon) —
  ticket frontend séparé une fois ce correctif backend fusionné, même
  pattern que B-039.
- Détection de falsification (analyse d'image/ML) — RESEARCH REQUIRED,
  pas ce ticket.
- Comparaison cross-organisation — hors scope volontairement : deux
  organisations différentes peuvent légitimement uploader un même document
  (ex. modèle de formulaire officiel), pas un signal de fraude en soi.

## Critères d'acceptation

- Upload d'un fichier au contenu binaire inédit dans l'organisation :
  `duplicate_of` reste `null`.
- Upload d'un fichier dont le contenu binaire est identique à un `Document`
  déjà existant dans la **même** organisation (même hash, quel que soit
  jalon/déclaration/catégorie) : `duplicate_of` pointe vers ce document.
- Upload d'un fichier identique à un `Document` d'une **autre**
  organisation : `duplicate_of` reste `null` (comparaison strictement
  intra-organisation).
- Trois uploads successifs du même contenu : le 2e et le 3e pointent tous
  deux vers le 1er (l'original), jamais le 3e vers le 2e.
- L'upload réussit dans tous les cas (jamais de 4xx à cause d'un doublon).
- Aucune régression sur les tests existants de `apps/evidence/tests.py`.
