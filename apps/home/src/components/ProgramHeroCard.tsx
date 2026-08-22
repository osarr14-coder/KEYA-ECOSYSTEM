import {
  Button, brandColors, semanticColors, spacing,
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
 * F-039), jamais un nouveau style inventé — fait office de « badge or
 * discret » (décision D, F-046), pas de widget supplémentaire déconnecté
 * d'une donnée réelle.
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
        borderRadius: '10px',
        overflow: 'hidden',
        background: semanticColors.neutral.surface,
      }}
    >
      <div
        style={{
          background: brandColors.navy,
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          padding: `${spacing.md} ${spacing.lg}`,
        }}
      >
        <span style={{ color: brandColors.gold, fontWeight: 700 }}>K+</span>
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
