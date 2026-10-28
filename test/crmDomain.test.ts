import { describe, it, expect } from 'vitest';
import {
  defaultWahrscheinlichkeit, phasenwechsel, aggregierePipeline, pflegeabdeckung, bucketWiedervorlagen,
  wochenende, heuteIso, istIsoDatum, newsletterCsv,
} from '../src/domain/crm';
import { ValidationError, ConflictError } from '../src/domain/errors';

describe('crm-domain: Wahrscheinlichkeit je Phase', () => {
  it('liefert die Defaults gemaess Spec', () => {
    expect(['lead', 'qualifiziert', 'offeriert', 'verhandlung', 'gewonnen', 'verloren'].map((p) => defaultWahrscheinlichkeit(p as any)))
      .toEqual([10, 25, 50, 75, 100, 0]);
  });
});

describe('crm-domain: Phasenwechsel', () => {
  const heute = '2026-10-28';
  it('offene Phase -> beliebige Phase, Default-Wahrscheinlichkeit, kein Abschlussdatum', () => {
    expect(phasenwechsel('lead', 'verhandlung', { heute })).toEqual({ phase: 'verhandlung', wahrscheinlichkeit: 75, abgeschlossenAm: null, verlustgrund: null });
    expect(phasenwechsel('verhandlung', 'qualifiziert', { heute }).wahrscheinlichkeit).toBe(25);
  });
  it('explizite Wahrscheinlichkeit nur fuer offene Phasen', () => {
    expect(phasenwechsel('lead', 'offeriert', { heute, wahrscheinlichkeit: 60 }).wahrscheinlichkeit).toBe(60);
    expect(phasenwechsel('lead', 'gewonnen', { heute, wahrscheinlichkeit: 60 }).wahrscheinlichkeit).toBe(100);
    expect(() => phasenwechsel('lead', 'offeriert', { heute, wahrscheinlichkeit: 101 })).toThrow(ValidationError);
  });
  it('gewonnen/verloren setzen abgeschlossenAm; verloren verlangt verlustgrund', () => {
    expect(phasenwechsel('offeriert', 'gewonnen', { heute })).toEqual({ phase: 'gewonnen', wahrscheinlichkeit: 100, abgeschlossenAm: heute, verlustgrund: null });
    expect(() => phasenwechsel('offeriert', 'verloren', { heute })).toThrow(ValidationError);
    expect(() => phasenwechsel('offeriert', 'verloren', { heute, verlustgrund: '  ' })).toThrow(ValidationError);
    expect(phasenwechsel('offeriert', 'verloren', { heute, verlustgrund: ' Preis ' }))
      .toEqual({ phase: 'verloren', wahrscheinlichkeit: 0, abgeschlossenAm: heute, verlustgrund: 'Preis' });
  });
  it('unbekannte Phase -> ValidationError', () => {
    expect(() => phasenwechsel('lead', 'irgendwas' as any, { heute })).toThrow(ValidationError);
  });
  it('gewonnen/verloren sind final ausser Wiedereroeffnung in eine offene Phase', () => {
    expect(() => phasenwechsel('gewonnen', 'verhandlung', { heute })).toThrow(ConflictError);
    expect(() => phasenwechsel('verloren', 'gewonnen', { heute })).toThrow(ConflictError);
    expect(() => phasenwechsel('verloren', 'gewonnen', { heute, wiedereroeffnen: true })).toThrow(ValidationError);
    expect(phasenwechsel('verloren', 'verhandlung', { heute, wiedereroeffnen: true }))
      .toEqual({ phase: 'verhandlung', wahrscheinlichkeit: 75, abgeschlossenAm: null, verlustgrund: null });
  });
});

describe('crm-domain: Pipeline', () => {
  const chancen = [
    { phase: 'lead', wertChf: 10000, wahrscheinlichkeit: null, erwarteterAbschluss: '2026-11-15' },        // 1000.00
    { phase: 'lead', wertChf: 333.33, wahrscheinlichkeit: 10, erwarteterAbschluss: '2026-11-30' },        // 33.33
    { phase: 'offeriert', wertChf: 20000, wahrscheinlichkeit: 40, erwarteterAbschluss: '2026-12-01' },   // 8000.00 (Override)
    { phase: 'verhandlung', wertChf: null, wahrscheinlichkeit: 75, erwarteterAbschluss: null },          // 0
    { phase: 'verhandlung', wertChf: 4000, wahrscheinlichkeit: null, erwarteterAbschluss: null },         // 3000.00
    { phase: 'gewonnen', wertChf: 5000, wahrscheinlichkeit: 100, erwarteterAbschluss: '2026-10-01' },
    { phase: 'verloren', wertChf: 7000, wahrscheinlichkeit: 0, erwarteterAbschluss: '2026-10-01' },
  ] as const;
  const p = aggregierePipeline(chancen as any);

  it('aggregiert je Phase in fester Reihenfolge (inkl. leerer Phasen)', () => {
    expect(p.phasen.map((x) => x.phase)).toEqual(['lead', 'qualifiziert', 'offeriert', 'verhandlung', 'gewonnen', 'verloren']);
    expect(p.phasen[0]).toEqual({ phase: 'lead', anzahl: 2, summeChf: 10333.33, gewichtetChf: 1033.33 });
    expect(p.phasen[1]).toEqual({ phase: 'qualifiziert', anzahl: 0, summeChf: 0, gewichtetChf: 0 });
    expect(p.phasen[2]).toEqual({ phase: 'offeriert', anzahl: 1, summeChf: 20000, gewichtetChf: 8000 });
    expect(p.phasen[3]).toEqual({ phase: 'verhandlung', anzahl: 2, summeChf: 4000, gewichtetChf: 3000 });
    expect(p.phasen[4]).toEqual({ phase: 'gewonnen', anzahl: 1, summeChf: 5000, gewichtetChf: 5000 });
    expect(p.phasen[5]).toEqual({ phase: 'verloren', anzahl: 1, summeChf: 7000, gewichtetChf: 0 });
  });
  it('Total offene Pipeline', () => {
    expect(p.offen).toEqual({ anzahl: 5, summeChf: 34333.33, gewichtetChf: 12033.33 });
  });
  it('Forecast je Monat nur fuer offene Phasen, sortiert; ohne Termin separat', () => {
    expect(p.forecast).toEqual([
      { monat: '2026-11', anzahl: 2, summeChf: 10333.33, gewichtetChf: 1033.33 },
      { monat: '2026-12', anzahl: 1, summeChf: 20000, gewichtetChf: 8000 },
    ]);
    expect(p.ohneTermin).toEqual({ anzahl: 2, summeChf: 4000, gewichtetChf: 3000 });
  });
});

describe('crm-domain: Pflegeabdeckung', () => {
  it('fuellt alle Klassifizierungen inkl. ohne und rechnet die Quote', () => {
    const r = pflegeabdeckung([
      { klassifizierung: 'A', organisationen: 4, gepflegt: 3 },
      { klassifizierung: null, organisationen: 2, gepflegt: 0 },
    ]);
    expect(r).toEqual([
      { klassifizierung: 'A', organisationen: 4, gepflegt: 3, abdeckungProzent: 75 },
      { klassifizierung: 'B', organisationen: 0, gepflegt: 0, abdeckungProzent: null },
      { klassifizierung: 'C', organisationen: 0, gepflegt: 0, abdeckungProzent: null },
      { klassifizierung: 'akquisition', organisationen: 0, gepflegt: 0, abdeckungProzent: null },
      { klassifizierung: 'ohne', organisationen: 2, gepflegt: 0, abdeckungProzent: 0 },
    ]);
  });
  it('rundet auf eine Nachkommastelle', () => {
    expect(pflegeabdeckung([{ klassifizierung: 'B', organisationen: 3, gepflegt: 1 }])[1].abdeckungProzent).toBe(33.3);
  });
});

describe('crm-domain: Wiedervorlagen', () => {
  it('Wochenende = Sonntag der laufenden Woche (Mo-So)', () => {
    expect(wochenende('2026-10-28')).toBe('2026-11-01'); // Mittwoch
    expect(wochenende('2026-11-01')).toBe('2026-11-01'); // Sonntag
    expect(wochenende('2026-11-02')).toBe('2026-11-08'); // Montag
    expect(wochenende('2026-12-30')).toBe('2027-01-03'); // Jahreswechsel
  });
  it('teilt nach Faelligkeit auf', () => {
    const a = [
      { id: '1', faelligAm: '2026-10-27' }, { id: '2', faelligAm: '2026-10-28' }, { id: '3', faelligAm: '2026-11-01' },
      { id: '4', faelligAm: '2026-11-02' }, { id: '5', faelligAm: null }, { id: '6', faelligAm: '2025-01-01' },
    ];
    const b = bucketWiedervorlagen(a, '2026-10-28');
    expect(b.ueberfaellig.map((x) => x.id)).toEqual(['6', '1']);
    expect(b.dieseWoche.map((x) => x.id)).toEqual(['2', '3']);
    expect(b.spaeter.map((x) => x.id)).toEqual(['4']);
    expect(b.ohneTermin.map((x) => x.id)).toEqual(['5']);
  });
});

describe('crm-domain: Hilfsfunktionen', () => {
  it('heuteIso in Europe/Zurich', () => {
    expect(heuteIso(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29'); // 00:30 MEZ
    expect(heuteIso(new Date('2026-10-28T10:00:00Z'))).toBe('2026-10-28');
  });
  it('istIsoDatum', () => {
    expect(istIsoDatum('2026-02-28')).toBe(true);
    expect(istIsoDatum('2026-02-30')).toBe(false);
    expect(istIsoDatum('28.02.2026')).toBe(false);
    expect(istIsoDatum(undefined)).toBe(false);
  });
});

describe('crm-domain: Newsletter-CSV', () => {
  it('Semikolon, Kopfzeile, Escaping und Schutz vor Formel-Injektion', () => {
    const csv = newsletterCsv([
      { email: 'a@b.ch', anrede: 'Frau', vorname: 'Anna', nachname: 'Muster', organisation: 'Bank; "Gross" AG' },
      { email: 'c@d.ch', anrede: null, vorname: null, nachname: '=HYPERLINK("x")', organisation: null },
      { email: 'e@f.ch', anrede: 'Herr', vorname: 'Jo\nhn', nachname: 'Zürcher', organisation: 'X' },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const zeilen = csv.slice(1).split('\r\n');
    expect(zeilen[0]).toBe('email;anrede;vorname;nachname;organisation');
    expect(zeilen[1]).toBe('a@b.ch;Frau;Anna;Muster;"Bank; ""Gross"" AG"');
    expect(zeilen[2]).toBe('c@d.ch;;;"\'=HYPERLINK(""x"")";');
    expect(csv).toContain('e@f.ch;Herr;"Jo\nhn";Zürcher;X');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
