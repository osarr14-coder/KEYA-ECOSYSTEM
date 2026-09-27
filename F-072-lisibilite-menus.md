# F-072 — Lisibilité des menus (thèmes clair et sombre)

Retour utilisateur : « le thème choisi ne permet pas une bonne visibilité des menus ».

## Constat (captures clair/sombre des 4 applications)

- Entrées de la barre latérale et onglets en gris « atténué », 13 px en densité « dense ».
- En-têtes de groupe (« VENTES & TARIFICATION ») à ~10 px.
- Icône du thème (lune) en gris sur le bandeau navy : quasi invisible en thème clair.
- Aucun retour visuel au survol d'une entrée.
- Mode sombre : zones de texte multiligne (contrat) restées blanches.

## Corrections (design system, communes aux 4 apps)

- Barre latérale : texte principal (plus « atténué »), 14 px, graisse 500 (active : 700, bordure
  or inchangée, fond inchangé — décision D du ticket F-048 respectée), entrées plus hautes ;
  en-têtes de groupe 11 px.
- Onglets : 14 px, texte principal, onglet actif souligné de 3 px (jamais de couleur de marque,
  gouvernance F-039).
- Survol et focus clavier visibles sur la navigation (`.keya-nav-link`, `.keya-tab`).
- Icône du thème lisible sur le bandeau.
- `textarea` aux couleurs du thème courant.
