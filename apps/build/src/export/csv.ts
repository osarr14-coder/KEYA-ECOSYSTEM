/**
 * Ticket F-032 — encodage CSV minimal (RFC 4180) : un champ est entouré de
 * guillemets, et ses guillemets internes doublés, dès qu'il contient une
 * virgule, un guillemet ou un saut de ligne — jamais échappé « au cas où »,
 * pour rester lisible sans guillemets superflus sur les valeurs simples
 * (noms de lots, pourcentages...).
 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * `\r\n` en séparateur de ligne (pas `\n` seul) — convention CSV la plus
 * largement reconnue par les tableurs, y compris Excel sous Windows, le
 * destinataire attendu de cet export (voir `lotsCsvExport.ts` pour le BOM
 * UTF-8, même raison).
 */
export function buildCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((line) => line.map(escapeCsvField).join(','))
    .join('\r\n');
}
