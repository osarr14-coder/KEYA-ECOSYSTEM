import type { LotRow } from '../api/types';
import { buildCsv } from './csv';

/**
 * Ticket F-032 — colonnes/formatage IDENTIQUES à ce qu'affiche
 * `AllLotsView.tsx` (même ordre, même libellé, même repli « — » pour une
 * organisation non affectée, même fraction jalons déclarés/total) :
 * l'export doit refléter ce que l'utilisateur voit à l'écran, pas une
 * projection différente des mêmes données.
 */
const HEADERS = [
  'Nom', 'Bien', 'Programme', 'Organisation constructrice',
  'Jalons déclarés', 'Avancement (%)', 'Réserves ouvertes',
];

function formatLotRow(row: LotRow): string[] {
  return [
    row.name,
    row.asset_name,
    row.program_name,
    row.assigned_organization_name ?? '—',
    `${row.declared_milestone_count}/${row.milestone_count}`,
    String(row.progress_percentage),
    String(row.open_reserve_count),
  ];
}

export function buildLotsCsv(rows: LotRow[]): string {
  return buildCsv(HEADERS, rows.map(formatLotRow));
}

/**
 * Nom de fichier daté (jour de l'export) — fonction pure séparée du `Date`
 * réel du navigateur pour rester testable sans horloge système.
 */
export function buildLotsExportFilename(now: Date): string {
  const iso = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return `tous-les-lots-${iso}.csv`;
}

/**
 * BOM UTF-8 (U+FEFF) en tête du fichier : Excel sous Windows — le
 * destinataire attendu de cet export — détecte sinon le fichier en ANSI et
 * corrompt les caractères accentués (noms de programmes/biens en
 * français). N'affecte aucun autre lecteur CSV correct (BOM ignoré/toléré
 * partout ailleurs). `String.fromCharCode(0xFEFF)` plutôt qu'un caractère
 * brut dans le source : un caractère invisible collé dans un template
 * littéral serait un piège pour toute relecture/diff futures.
 */
const UTF8_BOM = String.fromCharCode(0xFEFF);

export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([`${UTF8_BOM}${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
