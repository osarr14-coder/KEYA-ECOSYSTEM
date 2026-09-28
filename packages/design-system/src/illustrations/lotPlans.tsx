import { LotPlanA1 } from './LotPlanA1';

/**
 * PO-2026-09-28-26 — plans de lot disponibles, par programme et par lot. Seul
 * le lot A1 du programme fictif « Résidence Démonstration Abidjan » a un plan
 * (jeu DEMO-CI-v1). Le lot A2 n'en a pas encore : on n'affiche RIEN plutôt
 * qu'un plan qui ne lui correspond pas.
 */
const PLANS: Record<string, Record<string, () => JSX.Element>> = {
  'Résidence Démonstration Abidjan': { 'Lot A1': LotPlanA1 },
};

export function hasLotPlan(programName: string, lotName: string): boolean {
  return Boolean(PLANS[programName]?.[lotName]);
}

/** Vignette du plan (ouverture plein écran, zoom tactile) ou rien. */
export function LotPlan({ programName, lotName }: { programName: string; lotName: string }) {
  const Plan = PLANS[programName]?.[lotName];
  return Plan ? <Plan /> : null;
}
