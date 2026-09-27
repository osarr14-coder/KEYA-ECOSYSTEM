import type { ReactNode } from 'react';

import {
  Button, brandColors, semanticColors, typography, useIsMobile,
} from '@keya/design-system';

import type { PublicPath } from './usePublicPath';

/**
 * Ticket F-079 — gabarit des pages publiques (accueil, connexion,
 * inscription) : bandeau « démonstration » toujours visible (données
 * fictives, CDC §3.1), barre du haut, pied de page. Direction « Confiance
 * premium » (F-073) : ivoire, navy, or.
 */

export const CONTAINER_STYLE = {
  width: '100%',
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 clamp(16px, 4vw, 40px)',
  boxSizing: 'border-box',
} as const;

export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
      <span
        aria-hidden="true"
        style={{
          width: '36px', height: '36px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: brandColors.gold, color: brandColors.navy, fontFamily: typography.headingFontFamily, fontWeight: 600,
        }}
      >
        K+
      </span>
      <span
        style={{
          fontFamily: typography.headingFontFamily, fontWeight: 600, fontSize: '19px',
          color: light ? '#FFFFFF' : semanticColors.neutral.heading,
        }}
      >
        KEYIMMO AFRIC
      </span>
    </span>
  );
}

const NAV_ANCHORS: [string, string][] = [
  ['#programmes', 'Programmes'],
  ['#garanties', 'Garanties'],
  ['#chantiers', 'Chantiers'],
  ['#simulateur', 'Simulateur'],
  ['#faq', 'Questions'],
];

export function PublicLayout({
  path, navigate, children,
}: { path: PublicPath; navigate: (path: PublicPath) => void; children: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: semanticColors.neutral.background }}>
      <div
        role="note"
        data-testid="demo-ribbon"
        style={{
          background: brandColors.navy, color: '#E2C47A', textAlign: 'center', fontSize: '13px', fontWeight: 700,
          letterSpacing: '0.04em', padding: '6px 12px',
        }}
      >
        DÉMONSTRATION — programmes, prix et paiements fictifs, aucun fonds réel.
      </div>
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 20, background: semanticColors.neutral.surface,
          borderBottom: `1px solid ${semanticColors.neutral.border}`,
        }}
      >
        <div style={{ ...CONTAINER_STYLE, display: 'flex', alignItems: 'center', gap: '20px', minHeight: '68px' }}>
          <a
            href="/"
            onClick={(event) => { event.preventDefault(); navigate('/'); }}
            aria-label="KEYIMMO AFRIC — accueil"
          >
            <BrandMark />
          </a>
          {path === '/' && !isMobile && (
            <nav aria-label="Sections de la page" style={{ display: 'flex', gap: '4px', marginLeft: '12px' }}>
              {NAV_ANCHORS.map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="keya-tab"
                  style={{ padding: '8px 12px', borderRadius: '10px', fontWeight: 600, fontSize: '15px' }}
                >
                  {label}
                </a>
              ))}
            </nav>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            {path !== '/connexion' && (
              <Button type="button" variant="secondary" onClick={() => navigate('/connexion')}>Se connecter</Button>
            )}
            {path !== '/inscription' && !isMobile && (
              <Button type="button" variant="accent" onClick={() => navigate('/inscription')}>Créer mon espace</Button>
            )}
          </div>
        </div>
      </header>

      <main style={{ flexGrow: 1 }}>{children}</main>

      <footer style={{ background: brandColors.navy, color: '#C9D2E0', padding: '40px 0' }}>
        <div
          style={{
            ...CONTAINER_STYLE, display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'space-between', alignItems: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '420px' }}>
            <BrandMark light />
            <span style={{ fontSize: '14px' }}>
              Programmes immobiliers suivis de la réservation à la livraison : paiements sur le compte du programme,
              contrôle indépendant de chaque étape.
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
            <a href="#programmes" onClick={() => path !== '/' && navigate('/')}>Programmes</a>
            <a href="/connexion" onClick={(event) => { event.preventDefault(); navigate('/connexion'); }}>Espace client</a>
            <a href="/inscription" onClick={(event) => { event.preventDefault(); navigate('/inscription'); }}>Créer mon espace</a>
          </div>
          <span style={{ fontSize: '13px', color: 'rgba(201, 210, 224, 0.7)', width: '100%' }}>
            © KEYIMMO AFRIC — plateforme de démonstration, données fictives.
          </span>
        </div>
      </footer>
    </div>
  );
}
