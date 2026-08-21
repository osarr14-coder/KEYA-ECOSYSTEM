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
const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${typography.fontFamily};
    color: ${semanticColors.neutral.text};
    background: ${semanticColors.neutral.surface};
    -webkit-font-smoothing: antialiased;
  }
  button, input, select, textarea {
    font-family: inherit;
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
  .keya-btn:focus-visible,
  .keya-input:focus-visible,
  .keya-select:focus-visible {
    outline: none;
    border-color: ${semanticColors.neutral.text};
    box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.12);
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
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th {
    text-align: left;
    padding: 0.3em 0.6em;
    border-bottom: 2px solid ${semanticColors.neutral.border};
    font-size: 0.85em;
    font-weight: 500;
    color: ${semanticColors.neutral.textMuted};
  }
  td {
    padding: 0.3em 0.6em;
    border-bottom: 1px solid ${semanticColors.neutral.border};
    font-variant-numeric: tabular-nums;
  }
  tbody tr:hover td {
    background: ${semanticColors.neutral.background};
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
  h1 { font-size: 1.75em; font-weight: 700; line-height: 1.2; text-wrap: balance; }
  h2 { font-size: 1.35em; font-weight: 700; line-height: 1.3; text-wrap: balance; }
  h3 { font-size: 1.1em; font-weight: 600; line-height: 1.35; text-wrap: balance; }
  h4 { font-size: 1em; font-weight: 600; line-height: 1.4; text-wrap: balance; }
`;

export function GlobalStyles() {
  return <style data-testid="global-styles">{GLOBAL_CSS}</style>;
}
