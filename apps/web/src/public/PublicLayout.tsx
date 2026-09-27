import type { ReactNode } from 'react';

import {
  Button, brandColors, semanticColors, typography, useIsMobile,
} from '@keya/design-system';

import type { PublicPath } from './usePublicPath';

/**
 * Ticket F-079 — gabarit des pages publiques (accueil, connexion) : barre
 * du haut, pied de page. Le bandeau de démonstration est désormais commun à
 * tous les écrans (`DemoBanner`, monté à la racine de l'app — audit M01). Direction « Confiance
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
  ['#fonctionnement', 'Comment ça marche'],
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
      <header
        style={{
          position: 'sticky', top: 'var(--keya-demo-banner-height, 0px)', zIndex: 20, background: semanticColors.neutral.surface,
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
              Démonstration d’un parcours d’acquisition : versements sur le compte du programme (simulé) et examen de
              chaque jalon par un contrôleur.
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
