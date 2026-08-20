import type { AllLotsQuery, LotRow, PaginatedResponse } from '../api/types';

/**
 * Ticket F-032 — le tableau « Tous les lots » ne charge jamais que la page
 * courante (pagination réellement appliquée côté backend, `LotPagination`,
 * ticket 009) : `state.data.results` n'est structurellement PAS le jeu
 * complet filtré/trié. Exporter cette seule page aurait silencieusement
 * tronqué l'export dès qu'il y a plus d'une page — exactement ce que ce
 * ticket demande d'éviter.
 *
 * Aucun nouvel endpoint pour autant : `AllLotsView.get` (backend) calcule
 * déjà le filtre+tri COMPLET en mémoire avant de paginer (bornée en
 * requêtes SQL, `services.build_lot_rows`) — la pagination n'est qu'une
 * troncature de cette liste déjà calculée. On reparcourt donc le MÊME
 * endpoint avec le MÊME filtre/tri que l'écran (`baseQuery`, sans `page`),
 * à `pageSize` (le maximum autorisé côté backend, `LotPagination.
 * max_page_size`), jusqu'à épuiser les pages.
 */
export async function fetchAllLotRows(
  getAllLots: (query: AllLotsQuery) => Promise<PaginatedResponse<LotRow>>,
  baseQuery: AllLotsQuery,
  pageSize: number,
): Promise<LotRow[]> {
  const rows: LotRow[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    // eslint-disable-next-line no-await-in-loop -- pages dépendantes (page N+1 n'a de sens qu'après N), pas parallélisable.
    const response = await getAllLots({ ...baseQuery, page, page_size: pageSize });
    rows.push(...response.results);
    hasNext = response.next !== null;
    page += 1;
  }

  return rows;
}
