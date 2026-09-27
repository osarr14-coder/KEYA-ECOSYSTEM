# F-069 — Écrans chantier : déclaration (BUILD), affectation des contrôles (apps/web)

## Contexte

Limite relevée par F-068 : l'étape chantier du scénario CDC V3 §9.1 (déclaration, pièce,
contrôle, réserve, correction, levée) n'avait pas d'écran côté constructeur ni côté admin ;
elle passait par les services Django. Backend : B-054.

## Scope

- **BUILD — onglet « Jalons »** : choix du lot, jalons avec leur état dérivé par le serveur
  (non déclaré, pièce à joindre, en attente de contrôle, sous réserve, accepté). Actions :
  déclarer ; joindre une pièce (PDF/JPEG/PNG) ; sous réserve, proposer une correction avec une
  nouvelle pièce (la pièce est rattachée à la correction). Le constructeur ne lève jamais une
  réserve.
- **apps/web — onglet « Contrôles à affecter »** (admin KEYIMMO) : déclarations en attente de
  contrôle ou sous réserve, toutes organisations, correction proposée ou non, mission en cours ;
  « Missionner » un contrôleur (règle d'indépendance vérifiée par le serveur, refus affiché tel
  quel).
- **CONTROL — correctif** : la liste des missions ne lisait le cache local qu'une fois, avant la
  première synchronisation ; un contrôleur fraîchement connecté voyait « Aucune mission » alors
  qu'une mission lui était affectée. La synchronisation notifie désormais la liste
  (`keya:missions-updated`).

## Vérification

Parcours chantier déroulé dans les vrais écrans (serveur de développement, comptes de
démonstration B-053, Lot A2) : constructeur déclare « Fondations » et joint une pièce (BUILD)
→ admin missionne le contrôleur (apps/web) → contrôleur rend un avis avec réserve (CONTROL)
→ constructeur propose une correction (BUILD) → admin missionne le recontrôle → contrôleur rend
un avis conforme, la réserve est levée → jalon « Accepté techniquement », décaissable (B-052).
