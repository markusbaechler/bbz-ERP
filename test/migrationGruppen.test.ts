import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvRecords } from '../src/migration/csv';
import { gruppiereProjekte } from '../src/migration/gruppen';
import { ValidationError } from '../src/domain/errors';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mini.csv');

describe('gruppiereProjekte', () => {
  it('bildet je Parent-Zeile eine Gruppe mit ihren Kindzeilen', () => {
    const { records } = csvRecords(readFileSync(fixture, 'utf8'));
    const gruppen = gruppiereProjekte(records);
    expect(gruppen).toHaveLength(3);
    expect(gruppen.map((g) => g.projekt['Projekt_Nr.'])).toEqual(['1285.26', '4991.26', '6231.26']);
    expect(gruppen[0].kinder).toHaveLength(2);
    expect(gruppen[0].kinder[0]['Faktura::Erfassungsdatum']).toBe('23.03.2026');
    expect(gruppen[1].kinder).toHaveLength(0);
  });

  it('behaelt mehrzeilige Felder der Parent-Zeile', () => {
    const { records } = csvRecords(readFileSync(fixture, 'utf8'));
    const g = gruppiereProjekte(records);
    expect(g[0].projekt['Bereich']).toBe('IGK\nManagementausbildung');
    expect(g[1].projekt['Auftraggeber']).toBe('Universität St. Gallen\nInstitut für Banken und Finanzen');
  });

  it('wirft, wenn eine Kindzeile vor der ersten Parent-Zeile steht', () => {
    expect(() => gruppiereProjekte([{ 'Projekt_Nr.': '', Jahr: '2026' }])).toThrow(ValidationError);
  });
});
