import { MOBILE_BREAKPOINT_PX } from '../../tokens/breakpoints';
import { semanticColors } from '../../tokens/colors';
import { typography } from '../../tokens/typography';

/**
 * Ticket 023 (polish visuel) — reset minimal, monté UNE FOIS par app à sa
 * racine (`main.tsx`), jamais dans un composant partagé comme `AppShell`
 * (qui ne couvre ni l'écran de connexion d'apps/web, ni CONTROL PWA, qui
 * n'utilise pas `AppShell` — voir CLAUDE.md, section CONTROL PWA). Purement
 * additif : ne change ni structure ni comportement d'aucun composant
 * existant, uniquement l'apparence par défaut du navigateur (police, marges
 * de `<body>`, boîte de dimensionnement). Tout style inline explicite d'un
 * composant continue de prévaloir (spécificité CSS de l'attribut `style`).
 */
/**
 * Ticket F-051 — mode sombre. SOURCE UNIQUE des deux palettes (claire ET
 * sombre) : \`semanticColors\` (tokens/colors.ts) ne référence QUE des
 * \`var(--keya-*)\`, jamais une valeur en dur — ces valeurs vivent ici.
 * Valeurs claires IDENTIQUES aux hex retirés de colors.ts par ce même
 * ticket (aucun changement visuel en clair, comportement par défaut
 * strictement inchangé). Valeurs sombres choisies et VÉRIFIÉES (script
 * jetable, formule de luminance relative WCAG) avant intégration : texte
 * 16,3:1 (fond)/13,35:1 (surface), texte atténué 8,29:1/6,79:1, bordure
 * 2,92:1/2,39:1 — bordure sombre PLUS contrastée que la bordure claire
 * existante (1,18:1/1,24:1, jamais visée à 3:1 à l'origine) : ce ticket
 * n'introduit donc AUCUNE régression d'accessibilité par rapport au
 * comportement déjà en place.
 *
 * Trois états, jamais deux (comportement standard, même contrat que les
 * artefacts Claude) : \`system\` (défaut, aucun \`data-theme\` posé — suit
 * \`prefers-color-scheme\`) ; \`[data-theme="dark"]\`/\`[data-theme="light"]\`
 * (override explicite, \`useTheme.ts\`, hooks/) gagne TOUJOURS sur
 * \`prefers-color-scheme\` (\`:root:not([data-theme="light"])\` dans le bloc
 * media ci-dessous exclut le cas où l'utilisateur a explicitement choisi
 * clair alors que son OS est en sombre).
 */
const ROOT_COLOR_VARIABLES = `
  :root {
    --keya-neutral-border: #E4DCCB;
    --keya-neutral-background: #F7F3EA;
    --keya-neutral-surface: #FFFFFF;
    --keya-neutral-text: #16202E;
    --keya-neutral-text-muted: #5B6472;
    --keya-neutral-heading: #0B1D3A;
    --keya-neutral-subtle: #F4F1EA;
    --keya-alert-background: #FFFBEB;
    --keya-alert-border: #D97706;
    --keya-alert-icon: #D97706;
    --keya-alert-text: #92400E;
    --keya-danger-background: #FEF2F2;
    --keya-danger-border: #B91C1C;
    --keya-danger-icon: #B91C1C;
    --keya-danger-text: #7F1D1D;
    /* Volontairement IDENTIQUE dans les 3 blocs de ce fichier (clair,
       media dark, [data-theme="dark"]) — voir SemanticColorTokens.solid
       (tokens/colors.ts) pour la justification complète : remplissage
       solide de bouton, texte blanc fixe, jamais réinversé par thème. */
    --keya-danger-solid: #B91C1C;
    --keya-progress-track: #EDE5D2;
    --keya-progress-fill: #2F7D5B;
    /* Triplet R, G, B (pas un hex) — consommé par rgba(var(--keya-focus-ring-rgb), alpha)
       ci-dessous, technique vérifiée en navigateur réel avant intégration. */
    --keya-focus-ring-rgb: 11, 29, 58;
    --keya-primary-background: #0B1D3A;
    --keya-primary-text: #FFFFFF;
    /* Or plein et son texte : identiques dans les 3 blocs (même principe
       que --keya-danger-solid, un remplissage fixe jamais réinversé). */
    --keya-accent-solid: #C49A2C;
    --keya-accent-on-solid: #0B1D3A;
    --keya-accent-text: #8A6A12;
    --keya-accent-soft: #F4ECD6;
    --keya-success-background: #E3F2EA;
    --keya-success-text: #1E5E42;

    /* Ticket F-053 — ombres portées. Valeur UNIQUE, non redéfinie dans les
       blocs sombres : une ombre représente un éclairage ambiant, quasi
       toujours sombre même sur une surface sombre. Ticket F-073 : teinte
       navy (11, 29, 58) plutôt que gris ardoise, plus douce sur l'ivoire. */
    --keya-shadow-sm: 0 1px 2px rgba(11, 29, 58, 0.05);
    --keya-shadow-md: 0 8px 24px rgba(11, 29, 58, 0.06), 0 1px 3px rgba(11, 29, 58, 0.04);
    --keya-shadow-lg: 0 20px 44px rgba(11, 29, 58, 0.16), 0 4px 10px rgba(11, 29, 58, 0.06);
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --keya-neutral-border: #4A5F82;
      --keya-neutral-background: #0A1628;
      --keya-neutral-surface: #13233F;
      --keya-neutral-text: #F3F1EC;
      --keya-neutral-text-muted: #AEB9CB;
      --keya-neutral-heading: #F3F1EC;
      --keya-neutral-subtle: #1A2C4B;
      --keya-alert-background: #451A03;
      --keya-alert-border: #F59E0B;
      --keya-alert-icon: #F59E0B;
      --keya-alert-text: #FCD34D;
      --keya-danger-background: #450A0A;
      --keya-danger-border: #F87171;
      --keya-danger-icon: #F87171;
      --keya-danger-text: #FCA5A5;
      --keya-danger-solid: #B91C1C;
      --keya-progress-track: #2A3B58;
      --keya-progress-fill: #4CB88A;
      --keya-focus-ring-rgb: 243, 241, 236;
      --keya-primary-background: #E2C47A;
      --keya-primary-text: #0B1D3A;
      --keya-accent-solid: #C49A2C;
      --keya-accent-on-solid: #0B1D3A;
      --keya-accent-text: #E2C47A;
      --keya-accent-soft: #3A3016;
      --keya-success-background: #12352A;
      --keya-success-text: #8FD9B6;
    }
  }

  :root[data-theme="dark"] {
    --keya-neutral-border: #4A5F82;
    --keya-neutral-background: #0A1628;
    --keya-neutral-surface: #13233F;
    --keya-neutral-text: #F3F1EC;
    --keya-neutral-text-muted: #AEB9CB;
    --keya-neutral-heading: #F3F1EC;
    --keya-neutral-subtle: #1A2C4B;
    --keya-alert-background: #451A03;
    --keya-alert-border: #F59E0B;
    --keya-alert-icon: #F59E0B;
    --keya-alert-text: #FCD34D;
    --keya-danger-background: #450A0A;
    --keya-danger-border: #F87171;
    --keya-danger-icon: #F87171;
    --keya-danger-text: #FCA5A5;
    --keya-danger-solid: #B91C1C;
    --keya-progress-track: #2A3B58;
    --keya-progress-fill: #4CB88A;
    --keya-focus-ring-rgb: 243, 241, 236;
    --keya-primary-background: #E2C47A;
    --keya-primary-text: #0B1D3A;
    --keya-accent-solid: #C49A2C;
    --keya-accent-on-solid: #0B1D3A;
    --keya-accent-text: #E2C47A;
    --keya-accent-soft: #3A3016;
    --keya-success-background: #12352A;
    --keya-success-text: #8FD9B6;
  }
`;

const GLOBAL_CSS = `
  ${ROOT_COLOR_VARIABLES}

  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${typography.fontFamily};
    color: ${semanticColors.neutral.text};
    /* Ticket F-055 (suite F-053/F-054) — "neutral.background" (teinté),
       PAS "neutral.surface" (blanc pur) : sans ce contraste, le canevas de
       page et les cartes/le bandeau (tous deux "surface") sont
       rigoureusement identiques, rien ne "flotte" visuellement — retour
       utilisateur explicite sur le back-office. */
    background: ${semanticColors.neutral.background};
    -webkit-font-smoothing: antialiased;
  }
  button, input, select, textarea {
    font-family: inherit;
  }
  /* Ticket F-072 — zones de texte multiligne (contrat, commentaires) : aucun
     composant du design system ne les habille, elles restaient blanches en
     mode sombre. Couleurs du thème courant. */
  textarea {
    background: ${semanticColors.neutral.surface};
    color: ${semanticColors.neutral.text};
  }
  button {
    cursor: pointer;
  }
  a {
    color: inherit;
    text-decoration: none;
  }

  /*
   * Ticket F-038 — premier écart du projet vis-à-vis du "100% inline" :
   * ":hover"/":focus-visible"/":disabled" sont des pseudo-classes CSS,
   * inexprimables via un prop style={{}} React seul. Toutes les VALEURS
   * (couleurs, tailles) restent pilotées par les tokens JS dans les
   * composants eux-mêmes (Button/Input/Select) — ces règles ne gèrent QUE
   * le changement d'état, jamais une couleur nouvelle non dérivée d'un
   * token.
   */
  .keya-btn:hover:not(:disabled) {
    opacity: 0.85;
  }
  /* Ticket F-072 — survol visible des entrées de navigation (barre latérale,
     onglets) : sans lui, rien n'indiquait qu'une entrée est cliquable. */
  /* Ticket F-073 — la barre latérale est désormais navy dans les deux
     thèmes : survol en blanc translucide, focus en or. */
  .keya-nav-link:hover:not([aria-current="page"]) {
    background: rgba(255, 255, 255, 0.08);
    color: #FFFFFF;
  }
  .keya-tab:hover:not([aria-current="page"]) {
    background: rgba(var(--keya-focus-ring-rgb), 0.06);
  }
  .keya-nav-link:focus-visible {
    outline: 2px solid ${semanticColors.accent.solid};
    outline-offset: -2px;
  }
  .keya-tab:focus-visible {
    outline: 2px solid ${semanticColors.neutral.text};
    outline-offset: -2px;
  }
  /* Ticket F-073 — liens de contenu : navy souligné au survol, jamais le
     bleu par défaut du navigateur. */
  main a:not(.keya-btn):hover {
    color: ${semanticColors.accent.text};
  }
  .keya-btn:focus-visible,
  .keya-input:focus-visible,
  .keya-select:focus-visible {
    outline: none;
    border-color: ${semanticColors.neutral.text};
    /* Ticket F-051 — triplet R,G,B en variable CSS (--keya-focus-ring-rgb,
       défini dans ROOT_COLOR_VARIABLES ci-dessus), jamais un hex figé :
       l'anneau de focus doit rester lisible en mode sombre aussi, vérifié
       en navigateur réel (technique rgba(var(--x), alpha) confirmée). */
    box-shadow: 0 0 0 3px rgba(var(--keya-focus-ring-rgb), 0.12);
  }
  .keya-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /*
   * Ticket F-041 — consolidation des styles de tableau : jusqu'ici, les 5
   * vues à contenir un <table> (LotLedgerPanel/DevisView/PricingView/
   * LegalPaymentTiersView côté apps/web, AllLotsView côté apps/build)
   * redéfinissaient chacune, en style inline, un traitement proche mais
   * incohérent (padding 4px 8px vs 10px 12px, bordure d'en-tête présente
   * ou non). Unifié ici, en unités em — relatif à la taille de police
   * AMBIANTE déjà posée par le token de densité au niveau racine de
   * chaque app (dense 13px / confortable 15px / CONTROL PWA 16px
   * navigateur par défaut, aucun système de densité) — un seul jeu de
   * règles s'adapte aux 3 contextes sans coordination JS. Le
   * text-align: left sur th n'est PAS une simple préférence : chaque vue
   * le posait déjà en style inline (valeur par défaut du navigateur pour
   * th : centré), donc son retrait de ces vues rendrait ce fallback
   * nécessaire, pas optionnel.
   *
   * Ticket F-042 — font-size/font-weight/color de th AJOUTÉS ICI, dans ce
   * MÊME bloc (jamais un second bloc th ailleurs dans ce fichier) : une
   * seule règle gouverne chaque propriété de th de bout en bout, structure
   * (F-041) et typographie (F-042) confondues. 0.85em reste plus petit que
   * 1em (td, texte de donnée) à chaque densité par construction — les deux
   * étant des multiples de la même taille ambiante, leur ratio (85 %) ne
   * varie jamais.
   */
  /*
   * Ticket F-051 — audit UX : les 5 vues à contenir un <table> (voir F-041)
   * n'avaient aucune gestion de débordement horizontal sur petit viewport
   * — un tableau large forçait un scroll de LA PAGE ENTIÈRE plutôt que du
   * tableau lui-même (gap déjà noté hors scope au ticket F-050, jamais
   * traité depuis). Vérifié en navigateur réel (Chromium, 375px, script
   * jetable) AVANT d'écrire cette règle, pas seulement raisonné en CSS :
   * "overflow-x: auto" SEUL sur "table" ne fait RIEN (le tableau garde sa
   * largeur intrinsèque, le débordement de page reste identique) —
   * "display: block" est nécessaire pour que le tableau devienne une
   * boîte de défilement à lui seul. Alignement th/td PRÉSERVÉ malgré
   * "display: block" (vérifié aussi) : le navigateur génère une boîte de
   * tableau anonyme autour de <thead>/<tbody>/<tr>/<th>/<td> (qui gardent
   * leur display table-* par défaut, CSS2.1 §17.2), donc l'algorithme de
   * mise en page tableau tourne normalement à l'intérieur — seule la
   * boîte EXTÉRIEURE devient un bloc défilant.
   */
  table {
    border-collapse: collapse;
    width: 100%;
    display: block;
    overflow-x: auto;
  }
  /* Ticket F-073 — lignes plus aérées (0.3em → 0.7em) : les tableaux
     denses étaient le principal grief de lisibilité des écrans pros. */
  th {
    text-align: left;
    padding: 0.7em 0.9em;
    border-bottom: 2px solid ${semanticColors.neutral.border};
    font-size: 0.85em;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: ${semanticColors.neutral.textMuted};
  }
  td {
    padding: 0.7em 0.9em;
    border-bottom: 1px solid ${semanticColors.neutral.border};
    font-variant-numeric: tabular-nums;
  }
  tbody tr:hover td {
    background: ${semanticColors.neutral.subtle};
  }

  /*
   * Ticket F-042 — échelle typographique, en unités em relatives à la
   * taille de police AMBIANTE (même mécanisme que F-041) : un seul jeu de
   * règles couvre les 3 contextes réels (dense 13px, confortable 15px,
   * aucun système de densité/CONTROL PWA 16px), jamais une valeur px figée.
   * Inventaire réel avant conception (grep sur les 4 apps) : h1/h2 utilisés
   * dans plusieurs apps à plusieurs densités ; h3/h4 UNIQUEMENT dans
   * apps/web (dense, 13px) — vérifiables seulement à cette densité, jamais
   * inventé pour confortable/CONTROL où ils n'apparaissent nulle part ;
   * h5/h6 jamais utilisés, aucune règle. margin volontairement absent de
   * ces règles : la plupart des titres portent déjà leur propre marge
   * inline (marginTop/marginBottom/margin), la retirer risquerait une
   * régression de mise en page sur des écrans hors du périmètre de ce
   * ticket (voir F-041, section « hors scope »).
   *
   * h4 posé à 1em (pas <1em) : un h4 plus petit que le texte qu'il
   * introduit (ex. juste au-dessus d'un tableau, dont les cellules sont à
   * 1em depuis F-041) lirait à l'envers — distingué par le poids (600) et
   * text-wrap: balance, jamais par une taille réduite.
   */
  /*
   * Ticket F-053 — h1-h3 gagnent la police à empattement ("headingFontFamily",
   * tokens/typography.ts) : hiérarchie visuelle plus marquée entre titres et
   * interface, direction validée sur maquette (voir
   * F-053-refonte-visuelle-professionnelle.md). h4 exclu volontairement :
   * toujours utilisé comme libellé de section dense (jamais un vrai titre
   * éditorial dans les 4 apps, inventaire F-042 réutilisé tel quel), une
   * serif y détonnerait.
   */
  /* Ticket F-073 — Fraunces se lit mieux en graisse 600 qu'en 700 ; titres
     en couleur « heading » (navy en clair). */
  h1 { font-size: 1.75em; font-weight: 600; line-height: 1.2; text-wrap: balance; font-family: ${typography.headingFontFamily}; color: ${semanticColors.neutral.heading}; letter-spacing: -0.01em; }
  h2 { font-size: 1.35em; font-weight: 600; line-height: 1.3; text-wrap: balance; font-family: ${typography.headingFontFamily}; color: ${semanticColors.neutral.heading}; }
  h3 { font-size: 1.1em; font-weight: 600; line-height: 1.35; text-wrap: balance; font-family: ${typography.headingFontFamily}; color: ${semanticColors.neutral.heading}; }
  h4 { font-size: 1em; font-weight: 600; line-height: 1.4; text-wrap: balance; }

  /*
   * Ticket F-050 — dette responsive de F-039 (recherche/CTA coupés à
   * 375px) : la LARGEUR de la sidebar se résout en JS, comme avant ce
   * ticket (AppShell.tsx, effectiveCollapsed, style inline, jamais un
   * !important ici pour contourner un style inline existant). Le
   * débordement du header (recherche + sélecteurs optionnels + Task
   * Inbox + avatar, tous alignés sur une seule ligne), lui, dépend de
   * dimensions intrinsèques du navigateur qu'aucun style inline ne peut
   * exprimer conditionnellement — media query, même précédent que les
   * pseudo-classes ci-dessus (ticket F-038). MOBILE_BREAKPOINT_PX :
   * SEUIL UNIQUE partagé avec useIsMobile (hooks/useIsMobile.ts),
   * jamais une seconde valeur à resynchroniser manuellement.
   */
  @media (max-width: ${MOBILE_BREAKPOINT_PX}px) {
    [data-testid="app-shell-header"] {
      flex-wrap: wrap;
    }
    [data-testid="app-shell-header"] input[type="search"] {
      width: 100%;
    }
  }
`;

// Ticket F-073 — Fraunces (titres) + Manrope (interface, voir
// tokens/typography.ts), chargées une seule fois ici, jamais dupliquées
// par app. `data-testid` volontairement ABSENT de ce <link> : le test
// « rend une balise <style> unique » (GlobalStyles.test.tsx) cible
// `getByTestId('global-styles')`, qui doit continuer à résoudre le
// <style> lui-même sans ambiguïté.
const GOOGLE_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap';

export function GlobalStyles() {
  return (
    <>
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      <style data-testid="global-styles">{GLOBAL_CSS}</style>
    </>
  );
}
