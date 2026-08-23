import {
  BRAND_GRADIENT, Button, brandColors, semanticColors, spacing, typography,
} from '@keya/design-system';

/**
 * Ticket F-046 — raffinement de l'identité de marque KEYIMMO AFRIC posée
 * par F-039 : carte hero navy/blanc, remplaçant le `<header>` neutre
 * précédent d'`OverviewView`. HOME-only, jamais une extension du `Card`
 * partagé (`packages/design-system`) : la bande navy pleine est un besoin
 * propre à ce seul écran, aucun autre consommateur de `Card`
 * (BUILD/CONTROL/back-office) n'en a besoin — l'introduire dans le
 * composant partagé grossirait son API pour un seul appelant, doctrine
 * 17.3 (identité de marque strictement réservée à HOME).
 *
 * Repère « K+ » or : MÊME traitement que le repère de `AppShell` (ticket
 * F-039, badge dégradé depuis F-053), jamais un nouveau style inventé —
 * fait office de « badge or discret » (décision D, F-046), pas de widget
 * supplémentaire déconnecté d'une donnée réelle.
 *
 * Ticket F-053 (refonte visuelle) — bande d'en-tête en dégradé
 * (`BRAND_GRADIENT`, exporté par `AppShell.tsx`, MÊME valeur que la
 * sidebar/le bandeau HOME — jamais une seconde définition qui pourrait
 * diverger), `borderRadius` 10px→18px, ombre `--keya-shadow-md` (plus
 * prononcée que `Card` : cette carte est le point d'entrée visuel de
 * l'écran, doit se détacher davantage).
 *
 * `programName` n'apparaît QUE dans la bande navy — retiré du corps
 * blanc (décision confirmée, F-046) pour éviter la redite ; le corps
 * garde `lotName`/`assetLocation`, jamais `programName` une seconde fois.
 */
export interface ProgramHeroCardProps {
  programName: string;
  assetName: string;
  lotName: string;
  assetLocation: string;
  onRefresh: () => void;
}

export function ProgramHeroCard({
  programName, assetName, lotName, assetLocation, onRefresh,
}: ProgramHeroCardProps) {
  return (
    <div
      data-testid="hero"
      style={{
        border: `1px solid ${semanticColors.neutral.border}`,
        borderRadius: '18px',
        overflow: 'hidden',
        background: semanticColors.neutral.surface,
        boxShadow: 'var(--keya-shadow-md)',
      }}
    >
      <div
        style={{
          background: BRAND_GRADIENT,
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          padding: `${spacing.md} ${spacing.lg}`,
        }}
      >
        <span
          data-testid="hero-mark"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '30px',
            height: '30px',
            borderRadius: '9px',
            background: `linear-gradient(135deg, ${brandColors.gold}, #E4C878)`,
            color: brandColors.navy,
            fontWeight: 700,
            fontFamily: typography.headingFontFamily,
            fontSize: '0.9em',
            flexShrink: 0,
          }}
        >
          K+
        </span>
        <p style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>{programName}</p>
      </div>

      <div
        style={{
          padding: spacing.lg,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: spacing.md,
        }}
      >
        <div>
          <h1 style={{ marginBottom: '4px' }}>{assetName}</h1>
          <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>{lotName}</p>
          <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>{assetLocation}</p>
        </div>
        {/* Reste `secondary` (transparent, bordure/texte encre) : ce bouton
            vit dans le corps BLANC, jamais dans la bande navy — sur fond
            navy, un `secondary` (texte encre) serait illisible. */}
        <Button type="button" variant="secondary" onClick={onRefresh}>Actualiser</Button>
      </div>
    </div>
  );
}
