import { useEffect, useState } from 'react';

/**
 * État de connexion réseau du navigateur — `navigator.onLine` au montage,
 * synchronisé ensuite sur les événements `online`/`offline` de `window`.
 *
 * Ticket F-033 (vague 2) — implémentation UNIQUE, doctrine « toujours
 * réutiliser, jamais redéfinir » (CLAUDE.md) : extraite de
 * `apps/control-pwa/src/App.tsx` (ticket 010 passe 2, premier et jusque-là
 * seul consommateur), promue ici pour servir aussi HOME/BUILD/apps-web,
 * jamais dupliquée une seconde fois.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    function goOnline() {
      setIsOnline(true);
    }
    function goOffline() {
      setIsOnline(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}
