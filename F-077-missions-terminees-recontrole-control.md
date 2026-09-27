# F-077 — CONTROL : missions terminées et recontrôles (fin des « doublons »)

Retour : le contrôleur de démonstration voyait deux missions identiques « Lot A2 — Fondations ·
Première inspection ».

## Diagnostic

Ce n'étaient pas des doublons en base : deux missions légitimes sur le même jalon — le **premier
contrôle** (avis avec réserve) puis le **recontrôle** (avis conforme, réserve levée), toutes deux
déjà rendues. Deux défauts d'affichage les faisaient paraître en double :

1. CONTROL listait les missions rendues (`completed`) exactement comme les missions à faire ;
2. une mission de suivi n'était repérée que par sa réserve **ouverte** (`reserve_id`) : une fois la
   réserve levée, le recontrôle redevenait une « Première inspection ».

Supprimer ces missions aurait effacé l'historique du contrôle (qui a missionné qui, quand) sans
corriger la cause, qui se reproduisait à chaque recontrôle, y compris sur Render.

## Correctifs

- Backend : `list_missions_for_inspector` expose `follow_up` — mission affectée après une
  inspection antérieure du même jalon (reste vrai après la levée de la réserve).
- CONTROL : missions à faire en tête (seules cliquables) ; missions rendues dans une section
  « Terminées » en lecture seule avec la pastille « Avis rendu » ; étiquette « Recontrôle » quand
  `follow_up` est vrai sans réserve ouverte ; message explicite quand tout est rendu. Un cache
  local antérieur (sans `follow_up`) reste lisible.

## Tests

- Backend : `apps/control/tests.py` (recontrôle `follow_up` vrai, premier contrôle faux).
- CONTROL : 76 (`MissionsListView.test.tsx` : sections, étiquettes, missions rendues non
  cliquables, message « tout est rendu »).
- Vérifié en navigateur avec `inspecteur.demo@keya.test`.
