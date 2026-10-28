import { describe, it, expect } from 'vitest';
import {
  normalisiereProfil, normalisiereSprache, normalisiereUmfang, normalisiereVariante, pruefeVariante, pflichtteile,
  bestandenAusResultat, werteResultat, uebersicht, berechneStatus, muendlichZulassung, pruefeEinplanung,
  pruefeResultatErfassung, pruefeManuellenStatuswechsel, istPassiv, letztePruefung, hatGeplantenRun, referenzdatum,
  gueltigBis, quote, kennzahlen, kubaFeldschluessel, kubaZeile,
} from '../src/domain/saq';
import type { SaqRun, SaqStatus } from '../src/domain/saqTypes';
import { ConflictError, ValidationError } from '../src/domain/errors';

const run = (art: 'schriftlich' | 'muendlich', teil: number, nr: number, bestanden: boolean | null, datum = '2026-03-01', resultatProzent: number | null = null): SaqRun =>
  ({ art, teil, run: nr, datum, bestanden, resultatProzent });

const fall = (o: Partial<{ status: SaqStatus; profil: any; variante: any; umfang: any; arbeitgeberbestaetigungAm: string | null }> = {}) => ({
  status: 'in_pruefung' as SaqStatus, profil: 'PK' as const, variante: 'erstzertifizierung' as const, umfang: 'gesamtpaket' as const,
  arbeitgeberbestaetigungAm: '2026-01-15' as string | null, ...o,
});

describe('saq: Normalisierung (Whitelists wie bbz-saq)', () => {
  it('Profile inkl. Aliase, case-insensitiv', () => {
    expect(normalisiereProfil('pk')).toBe('PK');
    expect(normalisiereProfil('Affluent')).toBe('AFFL');
    expect(normalisiereProfil('AFF')).toBe('AFFL');
    expect(normalisiereProfil(' ccob ')).toBe('CCoB');
    expect(normalisiereProfil('PK FRZ')).toBe('PK');
    expect(() => normalisiereProfil('XY')).toThrow(ValidationError);
    expect(() => normalisiereProfil(undefined)).toThrow(ValidationError);
  });
  it('Sprache, Umfang, Variante', () => {
    expect(normalisiereSprache('fr')).toBe('FR');
    expect(normalisiereSprache('I')).toBe('IT');
    expect(normalisiereSprache(undefined)).toBe('DE');
    expect(() => normalisiereSprache('ES')).toThrow(ValidationError);
    expect(normalisiereUmfang(undefined)).toBe('gesamtpaket');
    expect(() => normalisiereUmfang('alles')).toThrow(ValidationError);
    expect(normalisiereVariante('Passerelle')).toBe('passerelle');
    expect(() => normalisiereVariante('tp1')).toThrow(ValidationError);
  });
  it('Passerelle nur fuer Profile mit Vorgaenger (IK<-PK, CWMA<-AFFL, CCoB<-KMU)', () => {
    expect(() => pruefeVariante('IK', 'passerelle')).not.toThrow();
    expect(() => pruefeVariante('PK', 'passerelle')).toThrow(ValidationError);
    expect(() => pruefeVariante('PK', 'erstzertifizierung')).not.toThrow();
  });
});

describe('saq: Pflicht-Teilpruefungen (PROFILE_PARTS)', () => {
  it('je Profil, muendlich immer OE1, Passerelle nur ein schriftlicher Teil', () => {
    expect(pflichtteile('PK', 'erstzertifizierung')).toEqual({ schriftlich: [1], muendlich: [1] });
    expect(pflichtteile('AFFL', 'erstzertifizierung').schriftlich).toEqual([1, 2]);
    expect(pflichtteile('CCoB', 'erstzertifizierung').schriftlich).toEqual([1, 2, 3]);
    expect(pflichtteile('CCoB', 'passerelle')).toEqual({ schriftlich: [1], muendlich: [1] });
  });
});

describe('saq: Bestehensgrenze ab 70 % (Auftraggeber 10.09.2026)', () => {
  it('70 ist bestanden, 69.99 nicht', () => {
    expect(bestandenAusResultat(70)).toBe(true);
    expect(bestandenAusResultat(69.99)).toBe(false);
    expect(bestandenAusResultat(100)).toBe(true);
    expect(bestandenAusResultat(0)).toBe(false);
  });
  it('bestanden ist massgebend; fehlt es, wird es aus dem Resultat abgeleitet', () => {
    expect(werteResultat({ resultatProzent: 72 })).toEqual({ resultatProzent: 72, score: null, bestanden: true, warnungen: [] });
    expect(werteResultat({ resultatProzent: 65, score: 39 }).bestanden).toBe(false);
    expect(werteResultat({ bestanden: true })).toEqual({ resultatProzent: null, score: null, bestanden: true, warnungen: [] });
  });
  it('Widerspruch bestanden/Resultat wird akzeptiert, aber als Warnung gemeldet', () => {
    const w = werteResultat({ resultatProzent: 65, bestanden: true });
    expect(w.bestanden).toBe(true);
    expect(w.warnungen).toHaveLength(1);
    expect(werteResultat({ resultatProzent: 80, bestanden: false }).warnungen).toHaveLength(1);
  });
  it('lehnt fehlende oder ungueltige Werte ab', () => {
    expect(() => werteResultat({})).toThrow(ValidationError);
    expect(() => werteResultat({ resultatProzent: 101 })).toThrow(ValidationError);
    expect(() => werteResultat({ resultatProzent: -1 })).toThrow(ValidationError);
    expect(() => werteResultat({ resultatProzent: 'x' })).toThrow(ValidationError);
    expect(() => werteResultat({ bestanden: 'yes' })).toThrow(ValidationError);
  });
});

describe('saq: Uebersicht und Status aus den Runs', () => {
  it('Teilstatus: bestanden, offen, endgueltig nach RUN3', () => {
    const u = uebersicht({ profil: 'AFFL', variante: 'erstzertifizierung', umfang: 'gesamtpaket' },
      [run('schriftlich', 1, 1, true), run('schriftlich', 2, 1, false), run('schriftlich', 2, 2, null)]);
    expect(u.teile).toEqual([
      { art: 'schriftlich', teil: 1, status: 'bestanden', versuche: 1, geplant: false },
      { art: 'schriftlich', teil: 2, status: 'offen', versuche: 1, geplant: true },
      { art: 'muendlich', teil: 1, status: 'offen', versuche: 0, geplant: false },
    ]);
    expect(u.schriftlichAlleBestanden).toBe(false);
    const ende = uebersicht({ profil: 'PK', variante: 'erstzertifizierung', umfang: 'gesamtpaket' },
      [run('schriftlich', 1, 1, false), run('schriftlich', 1, 2, false), run('schriftlich', 1, 3, false)]);
    expect(ende.teile[0].status).toBe('endgueltig_nicht_bestanden');
    expect(ende.endgueltigNichtBestanden).toBe(true);
  });
  it('Statusmatrix', () => {
    const f = { profil: 'AFFL' as const, variante: 'erstzertifizierung' as const, umfang: 'gesamtpaket' as const };
    expect(berechneStatus(f, [])).toBe('angemeldet');
    expect(berechneStatus(f, [run('schriftlich', 1, 1, null)])).toBe('in_pruefung');
    expect(berechneStatus(f, [run('schriftlich', 1, 1, true)])).toBe('in_pruefung');
    expect(berechneStatus(f, [run('schriftlich', 1, 1, true), run('schriftlich', 2, 2, true)])).toBe('schriftlich_bestanden');
    expect(berechneStatus(f, [run('schriftlich', 1, 1, true), run('schriftlich', 2, 1, true), run('muendlich', 1, 1, true)])).toBe('bestanden');
    expect(berechneStatus(f, [run('schriftlich', 1, 1, true), run('schriftlich', 2, 1, true),
      run('muendlich', 1, 1, false), run('muendlich', 1, 2, false), run('muendlich', 1, 3, false)])).toBe('nicht_bestanden');
    // Passerelle: ein schriftlicher Teil genuegt
    expect(berechneStatus({ profil: 'CWMA', variante: 'passerelle', umfang: 'gesamtpaket' }, [run('schriftlich', 1, 1, true)])).toBe('schriftlich_bestanden');
    // Umfang muendlich: schriftlich extern bestanden (Annahme)
    expect(berechneStatus({ profil: 'PK', variante: 'erstzertifizierung', umfang: 'muendlich' }, [run('muendlich', 1, 1, true)])).toBe('bestanden');
  });
});

describe('saq: Zulassung und Einplanung', () => {
  it('muendlich verlangt schriftlich bestanden UND Arbeitgeberbestaetigung (ausser Umfang muendlich)', () => {
    expect(muendlichZulassung(fall(), true)).toEqual({ zugelassen: true, gruende: [] });
    expect(muendlichZulassung(fall(), false).zugelassen).toBe(false);
    expect(muendlichZulassung(fall({ arbeitgeberbestaetigungAm: null }), true).gruende).toEqual(['Arbeitgeberbestaetigung fehlt']);
    expect(muendlichZulassung(fall({ umfang: 'muendlich' }), false).zugelassen).toBe(true);
    expect(muendlichZulassung(fall({ umfang: 'muendlich', arbeitgeberbestaetigungAm: null }), false).zugelassen).toBe(false);
    expect(muendlichZulassung(fall({ umfang: 'schriftlich' }), true).zugelassen).toBe(false);
  });
  it('naechster Run = max + 1, nur nach nicht bestandenem Vorlauf, hoechstens 3', () => {
    expect(pruefeEinplanung(fall({ status: 'angemeldet' }), [], 'schriftlich', 1, false)).toBe(1);
    expect(pruefeEinplanung(fall(), [run('schriftlich', 1, 1, false)], 'schriftlich', 1, false)).toBe(2);
    expect(() => pruefeEinplanung(fall(), [run('schriftlich', 1, 1, null)], 'schriftlich', 1, false)).toThrow(ConflictError);
    expect(() => pruefeEinplanung(fall(), [run('schriftlich', 1, 1, true)], 'schriftlich', 1, false)).toThrow(ConflictError);
    expect(() => pruefeEinplanung(fall(),
      [run('schriftlich', 1, 1, false), run('schriftlich', 1, 2, false), run('schriftlich', 1, 3, false)], 'schriftlich', 1, false)).toThrow(ConflictError);
  });
  it('Teil muss zum Profil passen, Experten nur muendlich, Umfang und Status werden geprueft', () => {
    expect(() => pruefeEinplanung(fall(), [], 'schriftlich', 2, false)).toThrow(ValidationError);
    expect(() => pruefeEinplanung(fall(), [], 'muendlich', 2, false)).toThrow(ValidationError);
    expect(() => pruefeEinplanung(fall(), [], 'schriftlich', 1, true)).toThrow(ValidationError);
    expect(() => pruefeEinplanung(fall({ umfang: 'selbststudium' }), [], 'schriftlich', 1, false)).toThrow(ConflictError);
    expect(() => pruefeEinplanung(fall({ umfang: 'schriftlich' }), [run('schriftlich', 1, 1, true)], 'muendlich', 1, false)).toThrow(ConflictError);
    for (const status of ['bestanden', 'zertifiziert', 'nicht_bestanden', 'abgebrochen'] as SaqStatus[]) {
      expect(() => pruefeEinplanung(fall({ status }), [], 'schriftlich', 1, false)).toThrow(ConflictError);
    }
  });
  it('muendliche Einplanung: 409 ohne bestandene schriftliche Pruefung oder Arbeitgeberbestaetigung', () => {
    expect(() => pruefeEinplanung(fall(), [], 'muendlich', 1, true)).toThrow(ConflictError);
    expect(() => pruefeEinplanung(fall({ arbeitgeberbestaetigungAm: null, status: 'schriftlich_bestanden' }),
      [run('schriftlich', 1, 1, true)], 'muendlich', 1, false)).toThrow(ConflictError);
    expect(pruefeEinplanung(fall({ status: 'schriftlich_bestanden' }), [run('schriftlich', 1, 1, true)], 'muendlich', 1, true)).toBe(1);
    expect(pruefeEinplanung(fall({ umfang: 'muendlich', status: 'angemeldet' }), [], 'muendlich', 1, false)).toBe(1);
  });
  it('Resultat nur einmal, nur in offenem Fall, muendlich nur mit Zulassung', () => {
    const offen = run('schriftlich', 1, 1, null);
    expect(() => pruefeResultatErfassung(fall(), [offen], offen)).not.toThrow();
    const fertig = run('schriftlich', 1, 1, true);
    expect(() => pruefeResultatErfassung(fall(), [fertig], fertig)).toThrow(ConflictError);
    expect(() => pruefeResultatErfassung(fall({ status: 'abgebrochen' }), [offen], offen)).toThrow(ConflictError);
    const m = run('muendlich', 1, 1, null);
    expect(() => pruefeResultatErfassung(fall({ arbeitgeberbestaetigungAm: null }), [run('schriftlich', 1, 1, true), m], m)).toThrow(ConflictError);
  });
  it('manuelle Statuswechsel: nur nicht_bestanden/abgebrochen aus offenen Faellen', () => {
    expect(() => pruefeManuellenStatuswechsel('in_pruefung', 'abgebrochen')).not.toThrow();
    expect(() => pruefeManuellenStatuswechsel('angemeldet', 'nicht_bestanden')).not.toThrow();
    expect(() => pruefeManuellenStatuswechsel('in_pruefung', 'bestanden')).toThrow(ConflictError);
    expect(() => pruefeManuellenStatuswechsel('zertifiziert', 'abgebrochen')).toThrow(ConflictError);
    expect(() => pruefeManuellenStatuswechsel('abgebrochen', 'in_pruefung')).toThrow(ConflictError);
    expect(() => pruefeManuellenStatuswechsel('angemeldet', 'irgendwas')).toThrow(ValidationError);
  });
});

describe('saq: Passiv, Referenzdatum, Gueltigkeit', () => {
  it('passiv = offen, letzte absolvierte Pruefung > 365 Tage, kein geplanter Termin', () => {
    const runs = [run('schriftlich', 1, 1, false, '2025-01-10')];
    expect(letztePruefung(runs)).toBe('2025-01-10');
    expect(istPassiv({ status: 'in_pruefung', letztePruefung: '2025-01-10', geplant: false }, '2026-01-11')).toBe(true);
    expect(istPassiv({ status: 'in_pruefung', letztePruefung: '2025-01-10', geplant: false }, '2026-01-10')).toBe(false);
    expect(istPassiv({ status: 'in_pruefung', letztePruefung: '2025-01-10', geplant: true }, '2026-06-01')).toBe(false);
    expect(istPassiv({ status: 'nicht_bestanden', letztePruefung: '2025-01-10', geplant: false }, '2026-06-01')).toBe(false);
    expect(istPassiv({ status: 'angemeldet', letztePruefung: null, geplant: false }, '2030-01-01')).toBe(false);
    expect(hatGeplantenRun([run('schriftlich', 1, 2, null, '2026-07-01')], '2026-06-01')).toBe(true);
    expect(hatGeplantenRun([run('schriftlich', 1, 2, null, '2026-05-01')], '2026-06-01')).toBe(false);
  });
  it('Referenzdatum = bestandener muendlicher Run, sonst letzter absolvierter Run', () => {
    expect(referenzdatum([run('schriftlich', 1, 1, true, '2026-02-01'), run('muendlich', 1, 1, true, '2026-05-01'),
      run('schriftlich', 2, 1, true, '2026-06-01')])).toBe('2026-05-01');
    expect(referenzdatum([run('schriftlich', 1, 1, false, '2026-02-01'), run('schriftlich', 1, 2, null, '2026-09-01')])).toBe('2026-02-01');
    expect(referenzdatum([run('schriftlich', 1, 1, null)])).toBeNull();
  });
  it('gueltig bis = ausgestellt + 3 Jahre (29.2. -> 28.2.)', () => {
    expect(gueltigBis('2026-10-28')).toBe('2029-10-28');
    expect(gueltigBis('2028-02-29')).toBe('2031-02-28');
    expect(() => gueltigBis('2026-13-01')).toThrow(ValidationError);
  });
});

describe('saq: Kennzahlen (Definitionen wie bbz-saq-Glossar)', () => {
  it('Quote mit Nenner, null bei n = 0', () => {
    expect(quote(2, 3)).toEqual({ quote: 66.7, zaehler: 2, n: 3 });
    expect(quote(0, 0)).toEqual({ quote: null, zaehler: 0, n: 0 });
  });
  it('zaehlt Vorgaenge nach Referenzjahr, Quote ueber abgeschlossene, Erstversuch und Resultat RUN1', () => {
    const k = kennzahlen(2026, [
      { profil: 'PK', status: 'zertifiziert', runs: [run('schriftlich', 1, 1, true, '2026-02-01', 80), run('muendlich', 1, 1, true, '2026-04-01', 90)] },
      { profil: 'PK', status: 'nicht_bestanden', runs: [run('schriftlich', 1, 1, false, '2026-02-01', 50), run('schriftlich', 1, 2, false, '2026-03-01', 60), run('schriftlich', 1, 3, false, '2026-05-01', 65)] },
      { profil: 'PK', status: 'in_pruefung', runs: [run('schriftlich', 1, 1, false, '2026-03-01', 60), run('schriftlich', 1, 2, null, '2026-11-01')] },
      { profil: 'AFFL', status: 'schriftlich_bestanden', runs: [run('schriftlich', 1, 1, true, '2026-03-01', 75), run('schriftlich', 2, 1, true, '2026-03-02', 85)] },
      { profil: 'PK', status: 'bestanden', runs: [run('schriftlich', 1, 1, true, '2025-02-01', 70), run('muendlich', 1, 1, true, '2025-05-01', 70)] }, // Referenzjahr 2025
      { profil: 'PK', status: 'angemeldet', runs: [] },
    ]);
    expect(k.jahr).toBe(2026);
    expect(k.total.vorgaenge).toBe(4);
    expect(k.total.abgeschlossen).toBe(2);
    expect(k.total.bestanden).toBe(1);
    expect(k.total.quoteInsgesamt).toEqual({ quote: 50, zaehler: 1, n: 2 });
    expect(k.total.erstversuchSchriftlich).toEqual({ quote: 50, zaehler: 2, n: 4 });
    expect(k.total.erstversuchMuendlich).toEqual({ quote: 100, zaehler: 1, n: 1 });
    // je Vorgang Mittel ueber die Teile (AFFL: 80), dann ueber die Vorgaenge: (80 + 50 + 60 + 80) / 4
    expect(k.total.resultatErstversuchSchriftlich).toEqual({ mittel: 67.5, n: 4 });
    expect(k.total.resultatErstversuchMuendlich).toEqual({ mittel: 90, n: 1 });
    const pk = k.jeProfil.find((z) => z.profil === 'PK')!;
    expect(pk.vorgaenge).toBe(3);
    expect(k.jeProfil.map((z) => z.profil)).toEqual(['PK', 'IK', 'AFFL', 'CWMA', 'KMU', 'CCoB']);
    expect(k.jeProfil.find((z) => z.profil === 'IK')!.quoteInsgesamt).toEqual({ quote: null, zaehler: 0, n: 0 });
  });
});

describe('saq: KUBA-Export (bbz-saq HEADER_FIELDS)', () => {
  it('liefert alle Feldschluessel WE1-WE6 / OE1-OE2 x RUN1-RUN3', () => {
    const keys = kubaFeldschluessel();
    expect(keys.slice(0, 4)).toEqual(['lastName', 'firstName', 'role', 'employer']);
    expect(keys).toContain('we6.run3.location');
    expect(keys).toContain('oe2.run3.expert2');
    expect(keys).not.toContain('we1.run1.expert1');
    expect(keys).toContain('weAllPassed');
  });
  it('mappt Runs mit yes/no/leer und Resultat als Anteil', () => {
    const z = kubaZeile({
      fallId: 'f1', nachname: 'Muster', vorname: 'Anna', rolle: 'Kundenberaterin', organisationName: 'Testbank AG',
      profil: 'PK', sprache: 'DE', kommunikationssprache: 'de', geburtsdatum: '1990-04-01',
      zertifikat: { zertifikatNr: 'SAQ-1', ausgestelltAm: '2026-06-01', gueltigBis: '2029-06-01' },
      uebersicht: uebersicht({ profil: 'PK', variante: 'erstzertifizierung', umfang: 'gesamtpaket' },
        [run('schriftlich', 1, 1, false), run('schriftlich', 1, 2, true), run('muendlich', 1, 1, true)]),
      runs: [
        { ...run('schriftlich', 1, 1, false, '2026-02-01', 65), score: 39, ort: 'Zuerich', remote: false, experte1: null, experte2: null },
        { ...run('schriftlich', 1, 2, true, '2026-03-01', 72.5), score: null, ort: null, remote: true, experte1: null, experte2: null },
        { ...run('muendlich', 1, 1, true, '2026-05-01', 80), score: null, ort: 'St. Gallen', remote: false, experte1: 'E. Eins', experte2: 'Z. Zwei' },
      ],
    });
    expect(z.lastName).toBe('Muster');
    expect(z.employer).toBe('Testbank AG');
    expect(z.certNumber).toBe('SAQ-1');
    expect(z.weAllPassed).toBe('yes');
    expect(z.oeAllPassed).toBe('yes');
    expect(z['we1.passed']).toBe('yes');
    expect(z['we1.run1.passed']).toBe('no');
    expect(z['we1.run1.result']).toBe(0.65);
    expect(z['we1.run1.score']).toBe(39);
    expect(z['we1.run1.location']).toBe('Zuerich');
    expect(z['we1.run2.location']).toBe('Remote');
    expect(z['we1.run3.passed']).toBe('');
    expect(z['we2.passed']).toBe('');
    expect(z['oe1.run1.expert1']).toBe('E. Eins');
    expect(z['oe1.run1.date']).toBe('2026-05-01');
    expect(z.erpFallId).toBe('f1');
    expect(Object.keys(z)).toEqual([...kubaFeldschluessel(), 'erpFallId']);
  });
});
