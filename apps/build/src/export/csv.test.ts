import { describe, expect, it } from 'vitest';

import { buildCsv } from './csv';

describe('buildCsv', () => {
  it('joint en-têtes et lignes avec des virgules, séparées par \\r\\n', () => {
    expect(buildCsv(['A', 'B'], [['1', '2'], ['3', '4']])).toBe('A,B\r\n1,2\r\n3,4');
  });

  it('n\'entoure PAS de guillemets un champ simple (lisibilité)', () => {
    expect(buildCsv(['Nom'], [['Lot 12']])).toBe('Nom\r\nLot 12');
  });

  it('entoure de guillemets un champ contenant une virgule', () => {
    expect(buildCsv(['Nom'], [['Résidence, bâtiment A']])).toBe('Nom\r\n"Résidence, bâtiment A"');
  });

  it('double les guillemets internes d\'un champ qui en contient', () => {
    expect(buildCsv(['Nom'], [['Lot "Le Phare"']])).toBe('Nom\r\n"Lot ""Le Phare"""');
  });

  it('entoure de guillemets un champ contenant un saut de ligne', () => {
    expect(buildCsv(['Note'], [['Ligne 1\nLigne 2']])).toBe('Note\r\n"Ligne 1\nLigne 2"');
  });

  it('gère un jeu de lignes vide (en-têtes seuls)', () => {
    expect(buildCsv(['A', 'B'], [])).toBe('A,B');
  });
});
