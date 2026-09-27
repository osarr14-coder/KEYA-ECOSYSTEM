# F-073 — Design system « Confiance premium » (direction A)

Retour utilisateur : « sur le frontend je ne suis pas d'accord, il a besoin d'une révolution ».
Deux directions maquettées (canevas de design) ; l'utilisateur a retenu la **direction A —
Confiance premium** : ivoire, encre, navy, or ; titres Fraunces, interface Manrope ; une seule
navigation latérale navy.

Refonte livrée en quatre étapes : F-073 (design system, ce ticket), F-074 (HOME « Mon
acquisition »), F-075 (apps/web « À faire » et fiche dossier), F-076 (BUILD et CONTROL).

## Livré

- **Palette** (variables CSS, clair et sombre, `GlobalStyles.tsx`) : fond ivoire `#F7F3EA`,
  surfaces blanches, bordures sable `#E4DCCB`, texte encre `#16202E`, titres navy `#0B1D3A`.
  Nouveaux rôles `semanticColors` : `primary` (action principale), `accent` (or plein, or
  lisible en texte `#8A6A12`, fond doux), `success`, `neutral.heading`, `neutral.subtle`.
  Mode sombre navy (`#0A1628` / `#13233F`), action principale en or clair.
- **Typographie** : Fraunces (titres h1–h3, graisse 600, navy) + Manrope (interface).
  Corps « dense » 13 → 14 px, « confortable » 15 → 16 px.
- **AppShell** : barre latérale navy pleine hauteur et collante (264 px, rail 64 px), logo
  K+ or, entrée active en or translucide + texte blanc gras + repère or ; compteur optionnel
  par module (`badge`) ; `onModuleSelect` pour une navigation SPA depuis la barre latérale ;
  `title` optionnel dans la barre du haut ; barre du haut blanche collante, actions en
  pastilles ; `brand` ne pose plus qu'un filet or (fin du bandeau navy en double).
- **Composants** : `Card` (rayon 20, marge 24, titre Fraunces 20 px, `eyebrow`, `action`),
  `Button` (rayon 12, 15 px gras, nouvelle variante `accent` or), `Input`/`Select` (rayon 12,
  15 px), `AlertBanner` (rayon 14), `TabBar` (repère actif or), tableaux plus aérés.
- **Nouveaux composants** : `Pill` (pastille d'état métier, 6 tons) et `PageHeader`
  (surtitre or, titre Fraunces, sous-titre, actions).
- HOME : le CTA « Voir toutes mes actions » n'écrase plus la couleur du bouton (il aurait été
  navy sur navy en mode sombre).

## Doctrine

Remplace la doctrine 17.3 et la décision D de F-048 — voir CLAUDE.md, section « Direction
Confiance premium ». Les composants partagés n'importent toujours jamais `brandColors` : ils
consomment des rôles thémés.

## Tests

- Design system : 190 (dont `Pill`, `PageHeader`, navigation `onModuleSelect`, compteurs,
  titre, cohérence des variables dans les 3 blocs de thème, variante `accent`).
- web 263, home 104, build 95, control 74 — tous verts ; typecheck OK.
- Captures clair/sombre vérifiées en navigateur (web, HOME, BUILD) avec les polices réelles.
