import { describe, expect, it, vi } from 'vitest';

import type { LotRow, PaginatedResponse } from '../api/types';
import { fetchAllLotRows } from './fetchAllLotRows';

function makeRow(id: string): LotRow {
  return {
    id, name: `Lot ${id}`, asset_name: 'Bien', program_id: 'p-1', program_name: 'Programme',
    assigned_organization_id: null, assigned_organization_name: null, milestone_count: 8,
    declared_milestone_count: 1, progress_percentage: 5, open_reserve_count: 0,
    created_at: '2026-03-01T00:00:00Z',
  };
}

function page(results: LotRow[], next: string | null): PaginatedResponse<LotRow> {
  return { count: 999, next, previous: null, results };
}

describe('fetchAllLotRows', () => {
  it('renvoie toutes les lignes d\'une seule page (next: null dès le départ)', async () => {
    const getAllLots = vi.fn().mockResolvedValue(page([makeRow('1'), makeRow('2')], null));

    const rows = await fetchAllLotRows(getAllLots, { ordering: 'name' }, 100);

    expect(rows.map((r) => r.id)).toEqual(['1', '2']);
    expect(getAllLots).toHaveBeenCalledTimes(1);
  });

  it('concatène plusieurs pages dans l\'ordre, jusqu\'à next: null', async () => {
    const getAllLots = vi.fn()
      .mockResolvedValueOnce(page([makeRow('1'), makeRow('2')], 'http://x/?page=2'))
      .mockResolvedValueOnce(page([makeRow('3'), makeRow('4')], 'http://x/?page=3'))
      .mockResolvedValueOnce(page([makeRow('5')], null));

    const rows = await fetchAllLotRows(getAllLots, { ordering: 'name' }, 2);

    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(getAllLots).toHaveBeenCalledTimes(3);
  });

  it('transmet EXACTEMENT le filtre/tri fourni à chaque page, avec page/page_size ajoutés', async () => {
    const getAllLots = vi.fn()
      .mockResolvedValueOnce(page([makeRow('1')], 'http://x/?page=2'))
      .mockResolvedValueOnce(page([makeRow('2')], null));

    await fetchAllLotRows(getAllLots, { ordering: '-progress_percentage', q: 'Ker', assigned: 'true' }, 100);

    expect(getAllLots).toHaveBeenNthCalledWith(1, {
      ordering: '-progress_percentage', q: 'Ker', assigned: 'true', page: 1, page_size: 100,
    });
    expect(getAllLots).toHaveBeenNthCalledWith(2, {
      ordering: '-progress_percentage', q: 'Ker', assigned: 'true', page: 2, page_size: 100,
    });
  });

  it('renvoie un tableau vide sans appel superflu quand la page initiale est vide', async () => {
    const getAllLots = vi.fn().mockResolvedValue(page([], null));

    const rows = await fetchAllLotRows(getAllLots, {}, 100);

    expect(rows).toEqual([]);
    expect(getAllLots).toHaveBeenCalledTimes(1);
  });

  it('propage une erreur de page intermédiaire sans avaler l\'échec (pas d\'export partiel silencieux)', async () => {
    const getAllLots = vi.fn()
      .mockResolvedValueOnce(page([makeRow('1')], 'http://x/?page=2'))
      .mockRejectedValueOnce(new Error('network down'));

    await expect(fetchAllLotRows(getAllLots, {}, 100)).rejects.toThrow('network down');
  });
});
