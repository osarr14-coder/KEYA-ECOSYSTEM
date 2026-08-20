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
`;

export function GlobalStyles() {
  return <style data-testid="global-styles">{GLOBAL_CSS}</style>;
}
