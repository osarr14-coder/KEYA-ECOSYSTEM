import { useEffect, useState } from 'react';

/**
 * Ticket F-051 — mode sombre. Trois états, même contrat que les artefacts
 * Claude (référence externe connue, pas une invention ad hoc) : `system`
 * (défaut, suit `prefers-color-scheme`, voir la media query de
 * `GlobalStyles`) ou un override EXPLICITE (`light`/`dark`), posé comme
 * attribut `data-theme` sur `<html>` — c'est cet attribut, jamais une
 * classe ni un style inline, que `GlobalStyles` cible pour ses overrides
 * (`:root[data-theme="dark"]`). Persisté en `localStorage` pour survivre à
 * un rechargement, MÊME clé de préfixe que les autres clés de ce projet
 * (`keya_*`, voir `receiveIncomingSession.ts`).
 */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'keya_theme_preference';

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function applyPreference(preference: ThemePreference) {
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', preference);
  }
}

export function useTheme(): { theme: ThemePreference; setTheme: (preference: ThemePreference) => void } {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredPreference);

  // Appliqué au montage ET à chaque changement — un rechargement de page
  // repart de `localStorage` (`readStoredPreference` ci-dessus, lu dans
  // `useState`), jamais du fallback silencieux `system` d'un composant qui
  // n'aurait pas encore eu son premier effet.
  useEffect(() => {
    applyPreference(theme);
  }, [theme]);

  function setTheme(preference: ThemePreference) {
    window.localStorage.setItem(STORAGE_KEY, preference);
    setThemeState(preference);
  }

  return { theme, setTheme };
}
