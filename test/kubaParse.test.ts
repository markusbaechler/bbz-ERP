import { describe, it, expect } from 'vitest';
import {
  leseWorkbook, leseKuba, parsePassed, parseResultat, parseDatum, parseGeburtsdatum, parseSprache, parseProfil, parseScore,
  parseExperte, parseArbeitgeber, ExcelDatum, KubaStrukturFehler, personenSchluessel, serialZuIso, type KubaVorgang,
} from '../tools/kuba-import/kuba';
import { baueKubaXlsx, standardDatei, serienzahl, HEUTE } from './kubaFixture';

describe('kuba-import: Normalisierungstabelle (wie bbz-saq)', () => {
  it('Passed: yes/YES/PASSED/fulfilled -> true, no/FAILED -> false, leer -> null, sonst Fehler', () => {
    expect(['yes', ' YES ', 'PASSED', 'Fulfilled', 'no', 'No', 'FAILED', '', null].map((x) => parsePassed(x).wert))
      .toEqual([true, true, true, true, false, false, false, null, null]);
    expect(parsePassed('vielleicht')).toMatchObject({ wert: null, stufe: 'fehler' });
    expect(parsePassed(true)).toMatchObject({ wert: null, stufe: 'fehler', grund: expect.stringContaining('kein Text') });
    expect(parsePassed('#N/A').stufe).toBe('fehler');
  });

  it('Result als Anteil 0–1: Zahl 0–1, Prozentwert > 1 (Hinweis), Text mit %, sonst Fehler', () => {
    expect(parseResultat(0.82)).toEqual({ wert: 0.82 });
    expect(parseResultat(1)).toEqual({ wert: 1 });
    expect(parseResultat(71.5)).toMatchObject({ wert: 0.715, stufe: 'hinweis' });
    expect(parseResultat('89.00%')).toEqual({ wert: 0.89 });
    expect(parseResultat('89,5 %')).toEqual({ wert: 0.895 });
    expect(parseResultat(150)).toMatchObject({ wert: null, stufe: 'fehler' });
    expect(parseResultat('abc')).toMatchObject({ wert: null, stufe: 'fehler' });
  });

  it('Datum: Datumszelle, Excel-Serienzahl ohne Format (Hinweis), Text dd.mm.yy(yy)[ / hh:mm], sonst Fehler', () => {
    expect(parseDatum(new ExcelDatum(serienzahl('2024-03-04')))).toEqual({ wert: '2024-03-04' });
    expect(parseDatum(new ExcelDatum(serienzahl('2024-03-04') + 0.5833))).toEqual({ wert: '2024-03-04' });
    expect(parseDatum(45323)).toMatchObject({ wert: '2024-02-01', stufe: 'hinweis' });
    expect(parseDatum('15.03.2024 / 09:00')).toEqual({ wert: '2024-03-15' });
    expect(parseDatum('1.2.24')).toEqual({ wert: '2024-02-01' });
    expect(parseDatum('31.02.2024')).toMatchObject({ wert: null, grund: 'Datum ungueltig (Tag/Monat)' });
    expect(parseDatum('27.04. / 09:00').grund).toMatch(/ohne Jahr/);
    expect(parseDatum('01.01.202').grund).toMatch(/dreistellig/);
    expect(parseDatum(new ExcelDatum(serienzahl('1990-04-12'))).grund).toMatch(/Jahr unplausibel/);
    expect(parseDatum(1985).stufe).toBe('fehler');
    expect(parseGeburtsdatum(new ExcelDatum(serienzahl('1990-04-12')))).toEqual({ wert: '1990-04-12' });
    expect(parseGeburtsdatum(serienzahl('1985-11-30'))).toMatchObject({ wert: '1985-11-30', stufe: 'hinweis' });
    expect(parseGeburtsdatum(1985).stufe).toBe('fehler');   // nackte Jahreszahl ist keine Serienzahl
    expect(serialZuIso(60)).toBe('1900-02-28');
  });

  it('Sprache, Profil (Aliase), Score, Experte, Arbeitgeber (Alias-Map)', () => {
    expect(['de', 'FR', 'i', 'E'].map((x) => parseSprache(x).wert)).toEqual(['DE', 'FR', 'IT', 'EN']);
    expect(parseSprache('XX')).toMatchObject({ wert: null, stufe: 'fehler' });
    expect(['PK', 'Affluent', 'AFF', 'af', 'CCOB', 'ccob', 'PK FRZ', 'cwma'].map((x) => parseProfil(x).wert))
      .toEqual(['PK', 'AFFL', 'AFFL', 'AFFL', 'CCoB', 'CCoB', 'PK', 'CWMA']);
    expect(parseProfil('XYZ')).toMatchObject({ wert: null, stufe: 'fehler' });
    expect(parseScore(41)).toEqual({ wert: 41 });
    expect(parseScore(4.5).stufe).toBe('nicht-ausgewertet');
    expect(parseScore(45000).stufe).toBe('nicht-ausgewertet');   // passt nicht in saq_pruefung.score
    expect(parseExperte('  Zeno   Zweitpruefer ')).toEqual({ wert: 'Zeno Zweitpruefer' });
    expect(parseExperte(17).stufe).toBe('fehler');
    expect(parseArbeitgeber('bekb')).toEqual({ roh: 'bekb', kanon: 'Berner Kantonalbank AG' });
    expect(parseArbeitgeber('Bank Unbekannt AG')).toEqual({ roh: 'Bank Unbekannt AG', kanon: 'Bank Unbekannt AG' });
    expect(personenSchluessel('Müller-Wyss', ' Zoë ', '1990-01-01')).toBe('muller wyss|zoe|1990-01-01');
  });
});

describe('kuba-import: Datei lesen', () => {
  it('liest nur die zwei KUBA-Sheets: Header Zeile 10, Daten ab Zeile 11, Threaded Comment auf B', () => {
    const sheets = leseWorkbook(standardDatei());
    expect(sheets.map((s) => [s.quelle, s.sheet])).toEqual([['first', 'First Certification'], ['issued', 'Ausgestellte Zertifikate']]);
    const first = sheets[0];
    expect(first.header.slice(0, 3)).toEqual(['Nr', 'Last Name', 'First Name']);
    expect(first.zeilen[0].zeile).toBe(11);
    expect(first.zeilen[0].kommentar).toMatch(/^VSM 8718/);
    expect(first.zeilen[0].zellen[3]).toBeInstanceOf(ExcelDatum);
    expect(sheets[1].header).not.toContain('WE6 RUN1 Location');
    expect(sheets[1].header).toContain('WE1 RUN1 yes');
  });

  it('fehlender Pflicht-Header, mehrdeutiger Header oder fehlendes Sheet = harter Fehler', () => {
    const ohneGeb = baueKubaXlsx({ first: [], issued: [], ohneHeader: { first: ['Birth Date'] } });
    expect(() => leseKuba(ohneGeb, HEUTE)).toThrow(KubaStrukturFehler);
    expect(() => leseKuba(ohneGeb, HEUTE)).toThrow(/First Certification.*«Birth Date»/);
    // Certificate Start Date ist nur im Sheet "Ausgestellte Zertifikate" Pflicht
    expect(() => leseKuba(baueKubaXlsx({ first: [], issued: [], ohneHeader: { issued: ['Certificate Start Date'] } }), HEUTE))
      .toThrow(/Ausgestellte Zertifikate.*Certificate Start Date/);
    expect(() => leseKuba(baueKubaXlsx({ first: [], issued: [], ohneHeader: { first: ['WE3 RUN2 Result'] } }), HEUTE)).toThrow(/WE3 RUN2 Result/);
    // optionale Header (Location, Experten, Communication Language) duerfen fehlen
    expect(() => leseKuba(baueKubaXlsx({ first: [], issued: [], ohneHeader: { first: ['WE1 RUN1 Location', 'OE1 RUN1 Expert 1', 'Communication Language'] } }), HEUTE)).not.toThrow();
    expect(() => leseKuba(baueKubaXlsx({ first: [], issued: [], ohneSheet: 'issued' }), HEUTE)).toThrow(/Sheet «Ausgestellte Zertifikate» fehlt/);
  });
});

describe('kuba-import: Vorgaenge (synthetische Standarddatei)', () => {
  const e = leseKuba(standardDatei(), HEUTE);
  const v = (nachname: string, profil: string | null): KubaVorgang => {
    const x = e.vorgaenge.filter((y) => y.nachname === nachname && y.profil === profil);
    expect(x, `${nachname}/${profil}`).toHaveLength(1);
    return x[0];
  };
  const dq = (sheet: 'First Certification' | 'Ausgestellte Zertifikate', zeile: number) => e.dq.filter((d) => d.sheet === sheet && d.zeile === zeile);

  it('zaehlt Zeilen je Sheet, Vorgaenge, Duplikate, Profilkonflikte und Personen', () => {
    expect(e.zaehler).toEqual({
      zeilen: { first: 9, issued: 3 }, ohneName: 1, vorgaenge: 10, duplikate: 1, profilKonflikte: 1,
      personen: 7, ohneGeburtsdatum: 1, mehrereProfile: 2,
    });
  });

  it('Duplikat ueber beide Sheets: zusammengefuehrt, Luecken aufgefuellt, Zertifikat -> zertifiziert', () => {
    const anna = v('Muster', 'PK');
    expect(anna.herkunft).toEqual(['First Certification:11', 'Ausgestellte Zertifikate:11']);
    expect(anna).toMatchObject({ zertifikatNr: 'Z-1001', zertifikatStart: '2024-06-01', zertifikatEnde: '2027-05-31', ausgestellt: true, vsm: true, vss: false, status: 'bestanden' });
    expect(anna.erp).toMatchObject({ status: 'zertifiziert', sprache: 'DE', kennzeichnung: 'VSM', zertifikat: { nr: 'Z-1001', ausgestelltAm: '2024-06-01', gueltigBis: '2027-05-31' } });
    expect(anna.erp!.runs).toEqual([
      { art: 'schriftlich', teil: 1, run: 1, datum: '2024-03-04', bestanden: true, resultatProzent: 82, score: 41, ort: 'Bern', remote: false, experte1: null, experte2: null },
      { art: 'muendlich', teil: 1, run: 1, datum: '2024-05-06', bestanden: true, resultatProzent: 90, score: 18, ort: 'Remote', remote: true, experte1: 'Erika Expertin', experte2: 'Zeno Zweitpruefer' },
    ]);
    expect(dq('Ausgestellte Zertifikate', 11).map((d) => d.grund)).toEqual([expect.stringMatching(/^Duplikat: derselbe Zertifizierungsvorgang wie «First Certification» Zeile 11/)]);
  });

  it('eine Person mit zwei Profilen: AFFL (Alias, Serienzahlen) offen und CWMA zertifiziert', () => {
    const affl = v('Beispiel', 'AFFL');
    const cwma = v('Beispiel', 'CWMA');
    expect(affl.personKey).toBe(cwma.personKey);   // Geburtsdatum einmal Serienzahl, einmal Datumszelle
    expect(affl.erp).toMatchObject({ status: 'schriftlich_bestanden', sprache: 'FR', zertifikat: null });
    expect(affl.erp!.runs.map((r) => [r.art, r.teil, r.run, r.datum, r.bestanden, r.resultatProzent])).toEqual([
      ['schriftlich', 1, 1, '2024-02-01', false, 55], ['schriftlich', 1, 2, '2024-04-01', true, 71.5],
      ['schriftlich', 2, 1, '2024-04-02', true, 80], ['muendlich', 1, 1, '2026-12-03', null, null],   // geplant, Formelvorgabe 0 ignoriert
    ]);
    expect(cwma.erp).toMatchObject({ status: 'zertifiziert', sprache: 'FR', zertifikat: { nr: 'Z-2002', ausgestelltAm: '2025-09-01', gueltigBis: '2028-09-01' } });
    const hinweise = dq('First Certification', 12).map((d) => `${d.header}: ${d.grund}`);
    expect(hinweise).toContainEqual(expect.stringMatching(/^Birth Date: Datum als Zahl ohne Datumsformat/));
    expect(hinweise).toContainEqual(expect.stringMatching(/^WE1 RUN1 Date: Datum als Zahl ohne Datumsformat \(45323\)/));
    expect(hinweise).toContainEqual(expect.stringMatching(/^WE1 RUN2 Result: Result «71.5» ohne Prozentzeichen/));
    expect(dq('Ausgestellte Zertifikate', 12).map((d) => d.header)).toEqual(['WE All yes', 'OE All yes']);
  });

  it('nicht bestanden, Sprache aus Programm (PK FRZ) bzw. Communication Language, unlesbare Zellen im Log', () => {
    expect(v('Exempel', 'PK').erp).toMatchObject({ status: 'nicht_bestanden', sprache: 'FR' });
    expect(v('Exempel', 'PK').erp!.runs.map((r) => r.datum)).toEqual(['2023-09-01', '2023-11-01', '2024-01-15']);
    expect(dq('First Certification', 13).map((d) => d.grund)).toContainEqual(expect.stringMatching(/Programmbezeichnung «PK FRZ».*\(FR\)/));

    const dora = v('Probe', 'CCoB');
    expect(dora.erp).toMatchObject({ status: 'in_pruefung', sprache: 'IT' });
    expect(dora.erp!.runs.map((r) => [r.run, r.datum, r.bestanden])).toEqual([[2, '2024-03-15', true]]);
    expect(dq('First Certification', 14).map((d) => [d.stufe, d.header, d.roh])).toEqual(expect.arrayContaining([
      ['fehler', 'WE1 RUN1 Passed', 'vielleicht'], ['fehler', 'WE1 RUN1 Date', '31.02.2024'], ['fehler', 'WE1 RUN1 Result', 'abc'],
      ['nicht-ausgewertet', 'WE1 RUN1 Score', '#N/A'], ['fehler', 'Certificate Language', 'XX'], ['hinweis', 'Certificate Language', 'XX'],
    ]));

    const gina = v('Fiktiv', 'IK');
    expect(gina).toMatchObject({ schluesselStufe: 'nur-name', personKey: 'fiktiv|gina|', arbeitgeberKanon: 'St. Galler Kantonalbank' });
    expect(gina.erp).toMatchObject({ status: 'angemeldet', sprache: 'EN', runs: [] });
  });

  it('Zeile ohne Namen, unbekanntes Profil, Profilkonflikt, Run ohne Datum, Zertifikat ohne Startdatum', () => {
    expect(dq('First Certification', 16)).toEqual([expect.objectContaining({ stufe: 'fehler', header: 'Last Name', grund: expect.stringMatching(/^Name fehlt \(Daten in: WE1 RUN1 Passed, WE1 RUN1 Date\)/) })]);
    expect(dq('First Certification', 15)).toEqual([]);   // Leerzeile
    const emil = e.vorgaenge.find((x) => x.nachname === 'Test')!;
    expect(emil).toMatchObject({ erp: null, nichtImportierbar: 'Profil «XYZ» unbekannt' });

    const hans = e.vorgaenge.filter((x) => x.nachname === 'Konflikt');
    expect(hans.map((x) => [x.herkunft, x.erp!.status])).toEqual([[['First Certification:19'], 'in_pruefung'], [['Ausgestellte Zertifikate:13'], 'bestanden']]);
    expect(dq('Ausgestellte Zertifikate', 13).map((d) => d.grund)).toEqual(expect.arrayContaining([
      expect.stringMatching(/abweichende Pruefungsdaten \(WE1 RUN1 Date\) – als eigener Vorgang/),
      expect.stringMatching(/Certificate Start Date fehlt oder unlesbar – Status bestanden/),
    ]));
    expect(dq('First Certification', 19).map((d) => d.grund)).toContainEqual(expect.stringMatching(/Alle Teilpruefungen der Vorgabe fuer PK \(WE1\) bestanden, aber Gesamtergebnis leer/));

    const annaAffl = v('Muster', 'AFFL');
    expect(annaAffl.erp).toMatchObject({ status: 'angemeldet', runs: [] });
    expect(dq('First Certification', 20).map((d) => d.grund)).toContainEqual('WE1 RUN1: Passed-Wert erfasst, aber kein Pruefungsdatum – Run wird nicht ins ERP uebernommen (Datum ist Pflicht)');
  });

  it('Grenzfaelle: nicht erfasst, VSS+VSM, Ende vor Start, Experte doppelt, Profil leer, Gleichstand -> Sheet 2', () => {
    const person = (nachname: string) => ({ 'Last Name': nachname, 'First Name': 'Synth', 'Birth Date': { datum: '1990-01-01' }, 'Certificate Language': 'DE' });
    const r = leseKuba(baueKubaXlsx({
      first: [
        { ...person('Unlesbar'), 'Certificate Program': 'KMU', 'WE All Passed': 'vielleicht', 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2025-01-01' }, _kommentar: 'VSS 07.05.2026 und VSM: Synth' },
        { ...person('Doppelt'), 'Certificate Program': 'IK', 'OE1 RUN1 Date': { datum: '2025-02-02' }, 'OE1 RUN1 Expert 1': 'Erika Expertin', 'OE1 RUN1 Expert 2': 'erika  EXPERTIN' },
        { ...person('Ohneprofil'), 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2025-01-01' } },
        { ...person('Gleichstand'), 'Certificate Program': 'PK', 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2025-01-01' } },
      ],
      issued: [
        { ...person('Gleichstand'), 'Certificate Program': 'PK', 'Certificate Number': 'Z-9', 'Certificate Start Date': { datum: '2025-06-01' }, 'Certificate End Date': { datum: '2025-01-01' }, 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2025-01-01' } },
      ],
    }), HEUTE);
    const v = (n: string) => r.vorgaenge.find((x) => x.nachname === n)!;
    expect(v('Unlesbar')).toMatchObject({ weStatus: 'nicht erfasst', status: 'nicht erfasst', vss: true, vsm: true });
    expect(v('Unlesbar').erp).toMatchObject({ status: 'in_pruefung', kennzeichnung: 'VSS, VSM' });
    expect(v('Doppelt').erp!.runs[0]).toMatchObject({ experte1: 'Erika Expertin', experte2: null, bestanden: null });
    expect(v('Ohneprofil')).toMatchObject({ erp: null, nichtImportierbar: 'Certificate Program leer' });
    expect(v('Gleichstand').herkunft).toEqual(['Ausgestellte Zertifikate:11', 'First Certification:14']);
    expect(v('Gleichstand').erp).toMatchObject({ status: 'zertifiziert', zertifikat: { nr: 'Z-9', ausgestelltAm: '2025-06-01', gueltigBis: '2028-06-01' } });
    expect(r.dq.map((d) => `${d.zeile} ${d.header}: ${d.grund}`)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^11 WE All Passed: Passed-Wert nicht in Whitelist/),
      expect.stringMatching(/^12 OE1 RUN1 Expert 2: Experte 1 = Experte 2/),
      expect.stringMatching(/^13 Certificate Program: Certificate Program leer – Vorgang wird nicht importiert/),
      expect.stringMatching(/^11 Certificate End Date: Certificate End Date 2025-01-01 liegt nicht nach dem Start 2025-06-01/),
    ]));
  });

  it('Data-Quality-Log ist nach Sheet und Zeile sortiert und hat Sheet, Zeile, Header, Rohwert, Grund', () => {
    const schluessel = e.dq.map((d) => `${d.sheet === 'First Certification' ? 0 : 1}-${String(d.zeile).padStart(3, '0')}`);
    expect(schluessel).toEqual([...schluessel].sort());
    for (const d of e.dq) expect(Object.keys(d).sort()).toEqual(['grund', 'header', 'roh', 'sheet', 'stufe', 'zeile']);
  });
});
