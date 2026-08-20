import { Blob as NodeBlob } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LotRow } from '../api/types';
import { buildLotsCsv, buildLotsExportFilename, downloadCsv } from './lotsCsvExport';

function makeRow(overrides: Partial<LotRow> = {}): LotRow {
  return {
    id: 'lot-1', name: 'Lot 12', asset_name: 'Résidence Ker', program_id: 'program-1',
    program_name: 'Programme Keur Massar', assigned_organization_id: null,
    assigned_organization_name: null, milestone_count: 8, declared_milestone_count: 1,
    progress_percentage: 5, open_reserve_count: 0, created_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildLotsCsv', () => {
  it('produit un en-tête identique aux colonnes affichées par AllLotsView', () => {
    const csv = buildLotsCsv([]);

    expect(csv).toBe('Nom,Bien,Programme,Organisation constructrice,Jalons déclarés,Avancement (%),Réserves ouvertes');
  });

  it('formate une ligne exactement comme le tableau à l\'écran (fraction jalons, %, tirets)', () => {
    const csv = buildLotsCsv([makeRow({ assigned_organization_name: 'Org Constructeur' })]);

    expect(csv).toContain('Lot 12,Résidence Ker,Programme Keur Massar,Org Constructeur,1/8,5,0');
  });

  it('affiche « — » pour une organisation non affectée, jamais une cellule vide silencieuse', () => {
    const csv = buildLotsCsv([makeRow({ assigned_organization_name: null })]);

    expect(csv).toContain('Lot 12,Résidence Ker,Programme Keur Massar,—,1/8,5,0');
  });

  it('échappe un nom de lot contenant une virgule', () => {
    const csv = buildLotsCsv([makeRow({ name: 'Lot 12, bâtiment A' })]);

    expect(csv).toContain('"Lot 12, bâtiment A"');
  });
});

describe('buildLotsExportFilename', () => {
  it('date le nom de fichier au format YYYY-MM-DD', () => {
    expect(buildLotsExportFilename(new Date('2026-08-20T14:32:00Z'))).toBe('tous-les-lots-2026-08-20.csv');
  });
});

describe('downloadCsv', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: { mockRestore: () => void };

  beforeEach(() => {
    createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    revokeObjectURL = vi.fn();
    // jsdom n'implémente pas URL.createObjectURL/revokeObjectURL nativement.
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    // Le `Blob` de jsdom n'implémente pas `.text()` — piège déjà documenté
    // pour CONTROL PWA (ticket 010) : réassigné au `Blob` natif de Node
    // pour ce describe uniquement (restauré après), jamais globalement.
    vi.stubGlobal('Blob', NodeBlob);
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('crée un Blob CSV avec BOM UTF-8, un lien de téléchargement nommé, et déclenche le clic', () => {
    downloadCsv('tous-les-lots-2026-08-20.csv', 'Nom\r\nLot 12');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blob] = createObjectURL.mock.calls[0] as [Blob];
    expect(blob.type).toBe('text/csv;charset=utf-8;');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('le contenu du Blob commence par les 3 octets du BOM UTF-8 (EF BB BF), avant le contenu CSV', async () => {
    // Lu en octets bruts, pas en texte décodé : un décodeur UTF-8 conforme
    // (`Blob.text()`) retire volontairement un BOM en tête au décodage —
    // c'est justement ce qui le rend invisible pour tout lecteur correct
    // tout en restant détectable par Excel, voir `lotsCsvExport.ts`. Une
    // assertion sur le texte décodé masquerait donc le BOM au lieu de le
    // vérifier.
    downloadCsv('x.csv', 'Nom\r\nLot 12');

    const [blob] = createObjectURL.mock.calls[0] as [Blob];
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF]);

    const decodedWithoutBom = new TextDecoder('utf-8').decode(bytes);
    expect(decodedWithoutBom).toBe('Nom\r\nLot 12');
  });
});
