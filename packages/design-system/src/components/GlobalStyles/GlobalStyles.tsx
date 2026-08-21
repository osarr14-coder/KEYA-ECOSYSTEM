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
   */
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th {
    text-align: left;
    padding: 0.3em 0.6em;
    border-bottom: 2px solid ${semanticColors.neutral.border};
  }
  td {
    padding: 0.3em 0.6em;
    border-bottom: 1px solid ${semanticColors.neutral.border};
    font-variant-numeric: tabular-nums;
  }
  tbody tr:hover td {
    background: ${semanticColors.neutral.background};
  }
`;

export function GlobalStyles() {
  return <style data-testid="global-styles">{GLOBAL_CSS}</style>;
}
