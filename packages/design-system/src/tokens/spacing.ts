/**
 * Ticket F-043 — grille d'espacement modulaire (discipline suisse,
 * Müller-Brockmann : chaque marge dérive d'une unité de base, jamais un
 * choix arbitraire par vue). Inventaire réel avant conception (grep sur
 * margin/padding/gap, 4 apps) : 106 valeurs sur 108 déjà des multiples de
 * 4px — la discipline existait déjà dans le code, seulement jamais
 * formalisée en token. Les 6 valeurs ci-dessous sont exactement celles
 * réellement utilisées aujourd'hui (4/8/12/16/20/24px), aucune taille
 * inventée au-delà de cet inventaire — même règle que F-042 (échelle
 * typographique) : jamais une valeur non observée dans le code réel.
 *
 * Portée de CE ticket : uniquement le token, jamais la migration des
 * dizaines de fichiers qui ont encore ces valeurs en dur inline — même
 * précédent que F-038 (« migration séquencée du reste du projet, ordre
 * suggéré, jamais imposée en un seul ticket »). Deux valeurs hors grille
 * trouvées pendant l'inventaire (`6px` dans `control-pwa/StatusDot`,
 * `2px` dans `control-pwa/InspectionFormView`) — signalées, pas touchées
 * ici : leur contexte visuel n'a pas été vérifié.
 */
export interface SpacingTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  xxl: string;
}

export const spacing: SpacingTokens = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
};
