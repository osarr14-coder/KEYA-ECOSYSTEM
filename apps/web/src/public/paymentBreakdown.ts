import type { PublicProgram } from '../api/types';

/**
 * Ticket F-079 — échéancier indicatif du simulateur public. MÊME règle que
 * le serveur (`apps.sales.services.compute_payment_call_candidates`) :
 * frais de réservation, puis complément du premier versement jusqu'au
 * plafond du premier palier (frais jamais comptés deux fois), puis chaque
 * palier suivant jusqu'à son plafond CUMULÉ, le dernier soldant le prix
 * exact. Indicatif : les vrais appels sont émis par KEYIMMO, et les paliers
 * de travaux seulement après acceptation technique du jalon correspondant.
 */
export interface BreakdownRow {
  key: string;
  label: string;
  when: string;
  amount: number;
  cumulativePercent: number;
}

export function paymentBreakdown(price: number, schedule: PublicProgram['payment_schedule']): BreakdownRow[] {
  if (!(price > 0)) return [];
  const fee = Math.min(Number(schedule.reservation_fee), price);
  const percent = (value: number) => Math.round((value / price) * 1000) / 10;
  const rows: BreakdownRow[] = [{
    key: 'frais', label: 'Frais de réservation', when: 'Après validation de votre dossier', amount: fee, cumulativePercent: percent(fee),
  }];
  const steps = schedule.steps;
  if (steps.length === 0) {
    if (price > fee) {
      rows.push({ key: 'solde', label: 'Solde', when: 'Selon le contrat', amount: price - fee, cumulativePercent: 100 });
    }
    return rows;
  }
  let called = fee;
  steps.forEach((step, index) => {
    const isLast = index === steps.length - 1;
    const target = isLast ? price : Math.round((price * Number(step.cumulative_cap_percent)) / 100);
    const amount = Math.max(0, target - called);
    called += amount;
    rows.push({
      key: step.code,
      label: index === 0 ? `Complément — ${step.label}` : step.label,
      when: index === 0 ? 'À la signature du contrat' : 'Après acceptation technique de l’étape',
      amount,
      cumulativePercent: percent(called),
    });
  });
  return rows;
}
