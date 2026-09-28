export { AlertBanner } from './components/AlertBanner/AlertBanner';
export type { AlertBannerProps } from './components/AlertBanner/AlertBanner';

export { ApiErrorBanner } from './components/ApiErrorBanner/ApiErrorBanner';
export type { ApiErrorBannerProps } from './components/ApiErrorBanner/ApiErrorBanner';

export { Card } from './components/Card/Card';
export type { CardProps } from './components/Card/Card';

export { Field } from './components/Field/Field';
export type { FieldProps } from './components/Field/Field';

export { AppShell, BRAND_GRADIENT } from './components/AppShell/AppShell';
export type {
  AppModule,
  AppShellOrganizationOption,
  AppShellProps,
  AppShellUser,
  Breadcrumb,
} from './components/AppShell/AppShell';

export { Button } from './components/Button/Button';
export type { ButtonProps } from './components/Button/Button';

export { GlobalStyles } from './components/GlobalStyles/GlobalStyles';

export { Icon } from './components/Icon/Icon';
export type { IconProps } from './components/Icon/Icon';
export type { IconName } from './components/Icon/paths';
export { ICON_PATHS } from './components/Icon/paths';

export { Input } from './components/Input/Input';
export type { InputProps } from './components/Input/Input';

export { isForbiddenError } from './errors/isForbiddenError';

export {
  buildCrossAppUrl, consumeLogoutRequest, logoutToLoginScreen, resolveAppOrigins,
} from './navigation/appOrigins';
export type { AppOrigins } from './navigation/appOrigins';

export { useIsMobile } from './hooks/useIsMobile';

export { useOnlineStatus } from './hooks/useOnlineStatus';

export { useTheme } from './hooks/useTheme';
export type { ThemePreference } from './hooks/useTheme';

export { KeyFigure } from './components/KeyFigure/KeyFigure';
export type { KeyFigureProps } from './components/KeyFigure/KeyFigure';

export { PageHeader } from './components/PageHeader/PageHeader';
export type { PageHeaderProps } from './components/PageHeader/PageHeader';

export { Pill } from './components/Pill/Pill';
export type { PillProps, PillTone } from './components/Pill/Pill';

export { ProgressBar } from './components/ProgressBar/ProgressBar';
export type { ProgressBarProps } from './components/ProgressBar/ProgressBar';

export { Select } from './components/Select/Select';
export type { SelectProps } from './components/Select/Select';


export { Stepper } from './components/Stepper/Stepper';
export type { StepState, StepperProps, StepperStep } from './components/Stepper/Stepper';

export { TabBar } from './components/TabBar/TabBar';
export type { TabBarProps, TabBarTab } from './components/TabBar/TabBar';

export { brandColors, semanticColors } from './tokens/colors';
export type {
  AccentColorTokens, BrandColorTokens, NeutralColorTokens, PrimaryColorTokens, ProgressColorTokens,
  SemanticColorTokens, SuccessColorTokens,
} from './tokens/colors';

export { ALL_DENSITIES, densityTokens } from './tokens/density';
export type { Density, DensityTokens } from './tokens/density';

export { spacing } from './tokens/spacing';
export type { SpacingTokens } from './tokens/spacing';

export { typography } from './tokens/typography';

export { radii } from './tokens/radii';

export { MOBILE_BREAKPOINT_PX } from './tokens/breakpoints';

export {
  ARCHIVE_MARKING, BRAND_NAME, CONTROLLER_DESIGNATION, DEMO_MARKING, SIMULATION_MARKING,
} from './copy/demoCopy';

export { DemoBanner, fetchDemoInstance, resetDemoInstanceCache } from './components/DemoBanner/DemoBanner';
export { SimulatedMark } from './components/SimulatedMark/SimulatedMark';
export {
  DISPLAY_TIME_ZONE, TIME_ZONE_SUFFIX, formatCalendarDate, formatServerDateTime,
} from './format/dates';
export { formatMoney, formatSurface, pluralize } from './format/numbers';
export type { SimulatedMarkProps } from './components/SimulatedMark/SimulatedMark';
export type { DemoBannerProps, DemoInstanceInfo } from './components/DemoBanner/DemoBanner';

// PO-2026-09-27-20 (DESIGN_SYSTEM §7, §9, §10, §12) : traçabilité et états.
export { ArchiveBanner } from './components/ArchiveBanner/ArchiveBanner';
export { DateTime } from './components/DateTime/DateTime';
export type { DateTimeProps } from './components/DateTime/DateTime';
export { EmptyState } from './components/EmptyState/EmptyState';
export type { EmptyStateProps } from './components/EmptyState/EmptyState';
export { Indicator, indicatorValue } from './components/Indicator/Indicator';
export type { IndicatorProps } from './components/Indicator/Indicator';
export { MONEY_KIND_LABELS, Money } from './components/Money/Money';
export type { MoneyKind, MoneyProps } from './components/Money/Money';
export { ReceiptProof } from './components/ReceiptProof/ReceiptProof';
export type { ReceiptProofAllocation, ReceiptProofProps } from './components/ReceiptProof/ReceiptProof';
export { Reference } from './components/Reference/Reference';
export type { ReferenceProps } from './components/Reference/Reference';
export { RESERVE_STATE_LABELS, ReserveCard } from './components/ReserveCard/ReserveCard';
export type { ReserveCardProps, ReserveState } from './components/ReserveCard/ReserveCard';
export { Skeleton } from './components/Skeleton/Skeleton';
export type { SkeletonProps } from './components/Skeleton/Skeleton';
export { Timeline } from './components/Timeline/Timeline';
export type { TimelineEntry, TimelineProps } from './components/Timeline/Timeline';
// PO-2026-09-28-04 : les niveaux de confiance ne s'affichent plus en badge
// (`StatusBadge` retiré) mais en échelle (`TrustLevels`) ou en ligne datée.
export {
  TRUST_LEVEL_FROM_API, TRUST_LEVEL_LABELS, TRUST_LEVEL_ORDER, TrustEventLine, TrustLevels,
} from './components/TrustLevels/TrustLevels';
export type {
  TrustEventData, TrustLevel, TrustLevelEvidence, TrustLevelKey, TrustLevelsProps,
} from './components/TrustLevels/TrustLevels';
export { VersionHistory } from './components/VersionHistory/VersionHistory';
export type { VersionEntry, VersionHistoryProps, VersionReview } from './components/VersionHistory/VersionHistory';
export { DateInput, MONTHS_SHORT } from './components/DateInput/DateInput';
export type { DateInputProps } from './components/DateInput/DateInput';

// PO-2026-09-28-26 : illustrations du programme fictif (page publique, espace client).
export { LotPlanA1, PLAN_CAPTION } from './illustrations/LotPlanA1';
export { FACADE_CAPTION, FacadeIllustration } from './illustrations/FacadeIllustration';
export { LotPlan, hasLotPlan } from './illustrations/lotPlans';
// PO-2026-09-28-27 / -28 : jauge segmentée et façade-jauge des jalons.
export { MilestoneGauge, MilestoneGaugeLegend, milestoneAccessibleLabel } from './components/MilestoneGauge/MilestoneGauge';
export type { GaugeMilestone, MilestoneGaugeProps } from './components/MilestoneGauge/MilestoneGauge';
export {
  MILESTONE_CLIENT_STATE_LABELS, MILESTONE_STATES, MILESTONE_STATE_LABELS, MILESTONE_STATE_TONES, milestoneStateLabel,
  resolveMilestoneState,
} from './components/MilestoneGauge/milestoneStates';
export type { MilestoneAudience, MilestoneState } from './components/MilestoneGauge/milestoneStates';
export { FACADE_PARTS, FacadeGauge, facadeAccessibleLabel } from './components/FacadeGauge/FacadeGauge';
export type { FacadeGaugeProps, FacadePart } from './components/FacadeGauge/FacadeGauge';
