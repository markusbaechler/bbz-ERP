import { describe, it, expect } from 'vitest';
import { parseCsv, csvRecords } from '../src/migration/csv';

describe('parseCsv', () => {
  it('trennt an ; und entfernt das BOM', () => {
    expect(parseCsv('﻿a;b\n1;2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('haelt Zeilenumbrueche innerhalb gequoteter Felder zusammen', () => {
    const rows = parseCsv('a;b\n"Zeile 1\nZeile 2";x\n');
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('Zeile 1\nZeile 2');
    expect(rows[1][1]).toBe('x');
  });

  it('entschluesselt doppelte Anfuehrungszeichen', () => {
    expect(parseCsv('a\n"er sagte ""hallo"""\n')[1][0]).toBe('er sagte "hallo"');
  });

  it('verwirft \\r und behaelt leere Felder', () => {
    expect(parseCsv('a;b;c\r\n1;;3\r\n')[1]).toEqual(['1', '', '3']);
  });
});

describe('csvRecords', () => {
  it('bildet Records ueber die Kopfzeile', () => {
    const { header, records } = csvRecords('Projekt_Nr.;Jahr\n6231.26;2026\n');
    expect(header).toEqual(['Projekt_Nr.', 'Jahr']);
    expect(records).toEqual([{ 'Projekt_Nr.': '6231.26', Jahr: '2026' }]);
  });

  it('fuellt fehlende Felder mit Leerstring', () => {
    const { records } = csvRecords('a;b;c\n1;2\n');
    expect(records[0]).toEqual({ a: '1', b: '2', c: '' });
  });
});
