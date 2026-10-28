import { describe, it, expect } from 'vitest';
import {
  werktageZwischen, slugify, durchfuehrungsCode, naechsteDurchfuehrungsNummer, addTage, addMonate, tageZwischen,
  istIsoDatum, pruefeDurchfuehrungsStatus, zeitKurz,
} from '../src/domain/kursplanung';
import { annullationsgebuehr } from '../src/domain/annullation';
import { rezertifizierungsStatus, standardGueltigBis } from '../src/domain/rezertifizierung';
import { berechneBelegung, pruefeTeilnahmeStatus, AKTIVE_ANMELDESTATUS } from '../src/domain/bildungTypes';
import { ANNULLATION, REZERTIFIZIERUNG, MOODLE } from '../src/config/bildung';
import { ConflictError, ValidationError } from '../src/domain/errors';

describe('kursplanung', () => {
  it('erzeugt Kurstage je Werktag (Mo-Fr) zwischen Start und Ende inkl.', () => {
    // 2026-11-06 = Freitag, 2026-11-10 = Dienstag
    expect(werktageZwischen('2026-11-06', '2026-11-10')).toEqual(['2026-11-06', '2026-11-09', '2026-11-10']);
    expect(werktageZwischen('2026-11-07', '2026-11-08')).toEqual([]);
    expect(werktageZwischen('2026-11-10', '2026-11-10')).toEqual(['2026-11-10']);
  });
  it('lehnt Ende vor Start ab', () => {
    expect(() => werktageZwischen('2026-11-10', '2026-11-09')).toThrow(ValidationError);
  });
  it('slugify ersetzt Umlaute und Sonderzeichen', () => {
    expect(slugify('Eigenheimfinanzierung für Fortgeschrittene')).toBe('eigenheimfinanzierung-fuer-fortgeschrittene');
    expect(slugify('  Ärger, Öl & Übermut!  ')).toBe('aerger-oel-uebermut');
    expect(slugify('Strasse/Grösse: Café Ñandú')).toBe('strasse-groesse-cafe-nandu');
    expect(slugify('Fuß')).toBe('fuss');
  });
  it('Code {ANGEBOT}-{JAHR}-{n} mit naechster freier Nummer', () => {
    expect(durchfuehrungsCode('BEF', 2026, 3)).toBe('BEF-2026-3');
    expect(naechsteDurchfuehrungsNummer([], 'BEF', 2026)).toBe(1);
    expect(naechsteDurchfuehrungsNummer(['BEF-2026-1', 'BEF-2026-4', 'BEF-2025-9', 'BEFX-2026-12', null], 'BEF', 2026)).toBe(5);
  });
  it('Datumsrechnung ohne Zeitzonenfehler', () => {
    expect(addTage('2026-03-28', 2)).toBe('2026-03-30');           // Sommerzeit-Umstellung
    expect(addMonate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonate('2024-02-29', 36)).toBe('2027-02-28');
    expect(addMonate('2026-11-15', -6)).toBe('2026-05-15');
    expect(tageZwischen('2026-10-28', '2026-11-27')).toBe(30);
    expect(tageZwischen('2026-11-27', '2026-10-28')).toBe(-30);
    expect(istIsoDatum('2026-02-29')).toBe(false);
    expect(istIsoDatum('2028-02-29')).toBe(true);
    expect(istIsoDatum('28.10.2026')).toBe(false);
  });
  it('kuerzt Uhrzeiten auf HH:MM', () => {
    expect(zeitKurz('08:30:00')).toBe('08:30');
    expect(zeitKurz(null)).toBeNull();
  });
  it('Statusuebergaenge der Durchfuehrung', () => {
    expect(() => pruefeDurchfuehrungsStatus('geplant', 'ausgeschrieben', 1)).not.toThrow();
    expect(() => pruefeDurchfuehrungsStatus('ausgeschrieben', 'bestaetigt', 1)).not.toThrow();
    expect(() => pruefeDurchfuehrungsStatus('bestaetigt', 'durchgefuehrt', 1)).not.toThrow();
    expect(() => pruefeDurchfuehrungsStatus('geplant', 'abgesagt', 0)).not.toThrow();
    expect(() => pruefeDurchfuehrungsStatus('bestaetigt', 'abgesagt', 1)).not.toThrow();
    expect(() => pruefeDurchfuehrungsStatus('geplant', 'ausgeschrieben', 0)).toThrow(ConflictError);
    expect(() => pruefeDurchfuehrungsStatus('geplant', 'durchgefuehrt', 1)).toThrow(ConflictError);
    expect(() => pruefeDurchfuehrungsStatus('durchgefuehrt', 'abgesagt', 1)).toThrow(ConflictError);
    expect(() => pruefeDurchfuehrungsStatus('abgesagt', 'geplant', 1)).toThrow(ConflictError);
    expect(() => pruefeDurchfuehrungsStatus('geplant', 'unbekannt' as any, 1)).toThrow(ValidationError);
  });
});

describe('annullation', () => {
  it('Konfiguration ist als Daten hinterlegt', () => {
    expect(ANNULLATION.map((s) => s.prozent)).toEqual([0, 50, 100]);
    expect(REZERTIFIZIERUNG).toEqual({ lernstundenSoll: 24, gueltigkeitMonate: 36 });
    expect(MOODLE).toEqual({ einschreibenTageVorBeginn: 14, zugangTageNachEnde: 60 });
  });
  it('Staffel: >=30 Tage 0 %, 29-14 Tage 50 %, <14 Tage 100 %', () => {
    const start = '2026-12-01';
    expect(annullationsgebuehr(1200, start, '2026-11-01')).toEqual({ tageVorBeginn: 30, prozent: 0, gebuehrChf: 0 });
    expect(annullationsgebuehr(1200, start, '2026-11-02')).toEqual({ tageVorBeginn: 29, prozent: 50, gebuehrChf: 600 });
    expect(annullationsgebuehr(1200, start, '2026-11-17')).toEqual({ tageVorBeginn: 14, prozent: 50, gebuehrChf: 600 });
    expect(annullationsgebuehr(1200, start, '2026-11-18')).toEqual({ tageVorBeginn: 13, prozent: 100, gebuehrChf: 1200 });
    expect(annullationsgebuehr(1200, start, '2026-12-03').prozent).toBe(100);   // nach Kursbeginn
  });
  it('rundet auf 5 Rappen und behandelt fehlenden Preis als 0', () => {
    expect(annullationsgebuehr(1234.55, '2026-12-01', '2026-11-20').gebuehrChf).toBe(1234.55);
    expect(annullationsgebuehr(99.9, '2026-12-01', '2026-11-10').gebuehrChf).toBe(49.95);
    expect(annullationsgebuehr(null, '2026-12-01', '2026-11-30').gebuehrChf).toBe(0);
  });
  it('akzeptiert eine abweichende Staffel', () => {
    const staffel = [{ abTagenVorBeginn: 7, prozent: 0 }, { abTagenVorBeginn: 0, prozent: 25 }];
    expect(annullationsgebuehr(400, '2026-12-01', '2026-11-28', staffel).gebuehrChf).toBe(100);
  });
});

describe('rezertifizierung', () => {
  const z = { ausgestelltAm: '2024-01-15', gueltigBis: '2027-01-15' };
  it('Gueltigkeit default 36 Monate', () => {
    expect(standardGueltigBis('2024-01-15')).toBe('2027-01-15');
  });
  it('zaehlt nur Lernstunden im Gueltigkeitszeitraum', () => {
    const s = rezertifizierungsStatus(z, [
      { datum: '2023-12-31', lernstunden: 100 },     // vor Ausstellung
      { datum: '2024-01-15', lernstunden: 8 },
      { datum: '2026-06-01', lernstunden: 7.5 },
      { datum: '2027-01-16', lernstunden: 50 },      // nach Ablauf
    ], { heute: '2026-10-28' });
    expect(s).toMatchObject({ lernstundenIst: 15.5, lernstundenSoll: 24, fehlend: 8.5, erfuellt: false, abgelaufen: false });
    expect(s.tageBisAblauf).toBe(79);
  });
  it('erfuellt bei >= Soll, abgelaufen nach gueltigBis', () => {
    const s = rezertifizierungsStatus(z, [{ datum: '2025-01-01', lernstunden: 24 }], { heute: '2027-01-16' });
    expect(s).toMatchObject({ erfuellt: true, fehlend: 0, abgelaufen: true });
  });
});

describe('anmeldung (Regeln)', () => {
  it('Belegung: aktiv, Warteliste, frei (nie negativ)', () => {
    expect(berechneBelegung(16, 10, 0)).toEqual({ kapazitaet: 16, aktiv: 10, warteliste: 0, frei: 6 });
    expect(berechneBelegung(2, 3, 4)).toEqual({ kapazitaet: 2, aktiv: 3, warteliste: 4, frei: 0 });
    expect(AKTIVE_ANMELDESTATUS).toEqual(['angemeldet', 'bestaetigt', 'teilgenommen', 'abgeschlossen']);
  });
  it('Teilnahme nur aus angemeldet/bestaetigt/teilgenommen/nicht_bestanden', () => {
    expect(() => pruefeTeilnahmeStatus('bestaetigt', 'teilgenommen')).not.toThrow();
    expect(() => pruefeTeilnahmeStatus('teilgenommen', 'abgeschlossen')).not.toThrow();
    expect(() => pruefeTeilnahmeStatus('nicht_bestanden', 'abgeschlossen')).not.toThrow();
    expect(() => pruefeTeilnahmeStatus('warteliste', 'teilgenommen')).toThrow(ConflictError);
    expect(() => pruefeTeilnahmeStatus('storniert', 'abgeschlossen')).toThrow(ConflictError);
    expect(() => pruefeTeilnahmeStatus('abgeschlossen', 'nicht_bestanden')).toThrow(ConflictError);
    expect(() => pruefeTeilnahmeStatus('bestaetigt', 'storniert' as any)).toThrow(ValidationError);
  });
});
