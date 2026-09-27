import { Button, semanticColors } from '@keya/design-system';

import { CONTAINER_STYLE } from './PublicLayout';
import type { PublicPath } from './usePublicPath';

/**
 * Audit UI R1 (R01, PO-2026-09-27-08) — plus d'inscription publique :
 * « Créer mon espace » devient « Accès sur invitation ». Aucun formulaire
 * d'identité (CDC §10) ; les comptes de démonstration sont provisionnés par
 * l'administrateur.
 */
export function AccessView({ navigate }: { navigate: (path: PublicPath) => void }) {
  return (
    <section aria-labelledby="access-title" style={{ ...CONTAINER_STYLE, padding: 'clamp(40px, 7vw, 88px) clamp(16px, 4vw, 40px)' }}>
      <div style={{ maxWidth: '620px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h1 id="access-title" style={{ margin: 0, fontSize: 'clamp(30px, 4vw, 40px)' }}>Accès sur invitation</h1>
        <p style={{ margin: 0, fontSize: '17px' }}>
          La démonstration KEYIMMO AFRIC n’est pas ouverte à l’inscription. Chaque participant reçoit un compte de
          démonstration fictif (client, gestionnaire, Finance, constructeur ou contrôleur), créé par l’administrateur
          de la démonstration.
        </p>
        <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>
          Toutes les données sont fictives : n’indiquez jamais d’identité, de coordonnées ou de références bancaires réelles.
        </p>
        <div>
          <Button type="button" onClick={() => navigate('/connexion')}>J’ai reçu un compte : se connecter</Button>
        </div>
      </div>
    </section>
  );
}
