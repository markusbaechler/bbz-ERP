import { describe, it, expect } from 'vitest';
import { istErlaubterUebergang, pruefeStatusWechsel, STATUS_UEBERGAENGE } from '../src/domain/projektStatus';
import { erzeugtZyklus, kanbanEinordnen } from '../src/domain/aufgabenGraph';
import { gruppiereZeit, formatStunden } from '../src/domain/zeitVerrechnung';
import { berechneCockpit, bewerteAmpel, tageZwischen, heuteIso, type CockpitRoh } from '../src/domain/cockpit';
import { PROJEKT_STATUS, type ProjektStatus } from '../src/domain/pmTypes';
import { ConflictError, ValidationError } from '../src/domain/errors';

describe('Projektstatus-Uebergaenge', () => {
  // Vollstaendige Matrix gemaess Spec §5.3 (Zeile = von, Eintraege = erlaubte Ziele)
  const erwartet: Record<ProjektStatus, ProjektStatus[]> = {
    akquise: ['offeriert', 'abgesagt'],
    offeriert: ['laufend', 'abgesagt'],
    laufend: ['abgeschlossen', 'abgesagt'],
    abgeschlossen: ['laufend', 'archiviert'],
    abgesagt: [],
    archiviert: [],
  };
  for (const von of PROJEKT_STATUS) {
    for (const nach of PROJEKT_STATUS) {
      const ok = erwartet[von].includes(nach);
      it(`${von} -> ${nach}: ${ok ? 'erlaubt' : 'verboten'}`, () => {
        expect(istErlaubterUebergang(von, nach)).toBe(ok);
      });
    }
  }
  it('Matrix-Konstante deckt alle Status ab', () => {
    expect(Object.keys(STATUS_UEBERGAENGE).sort()).toEqual([...PROJEKT_STATUS].sort());
  });
  it('verbotener oder unbekannter Status -> ValidationError', () => {
    expect(() => pruefeStatusWechsel({ von: 'akquise', nach: 'laufend', unverrechneteEintraege: 0, force: false })).toThrow(ValidationError);
    expect(() => pruefeStatusWechsel({ von: 'laufend', nach: 'pausiert' as any, unverrechneteEintraege: 0, force: false })).toThrow(ValidationError);
  });
  it('Abschluss mit unverrechneter Zeit -> Konflikt, ausser mit force', () => {
    expect(() => pruefeStatusWechsel({ von: 'laufend', nach: 'abgeschlossen', unverrechneteEintraege: 2, force: false })).toThrow(ConflictError);
    expect(pruefeStatusWechsel({ von: 'laufend', nach: 'abgeschlossen', unverrechneteEintraege: 2, force: true })).toEqual({ forciert: true });
    expect(pruefeStatusWechsel({ von: 'laufend', nach: 'abgeschlossen', unverrechneteEintraege: 0, force: true })).toEqual({ forciert: false });
    // andere Wechsel sind von unverrechneter Zeit nicht betroffen
    expect(pruefeStatusWechsel({ von: 'laufend', nach: 'abgesagt', unverrechneteEintraege: 5, force: false })).toEqual({ forciert: false });
  });
});

describe('Aufgaben-Graph: Zyklenerkennung', () => {
  // Kette a <- b <- c  (b hat Vorgaenger a, c hat Vorgaenger b)
  const kanten = new Map<string, string | null>([['a', null], ['b', 'a'], ['c', 'b'], ['x', null]]);
  it('Selbstbezug ist ein Zyklus', () => { expect(erzeugtZyklus('a', 'a', kanten)).toBe(true); });
  it('direkter Zyklus (a -> b, b -> a)', () => { expect(erzeugtZyklus('a', 'b', kanten)).toBe(true); });
  it('transitiver Zyklus (a -> c -> b -> a)', () => { expect(erzeugtZyklus('a', 'c', kanten)).toBe(true); });
  it('kein Zyklus bei unabhaengiger Kette oder ohne Vorgaenger', () => {
    expect(erzeugtZyklus('x', 'c', kanten)).toBe(false);
    expect(erzeugtZyklus('c', 'a', kanten)).toBe(false);
    expect(erzeugtZyklus('c', null, kanten)).toBe(false);
  });
  it('bricht bei bereits zyklischen Fremddaten ab (keine Endlosschleife)', () => {
    const kaputt = new Map<string, string | null>([['p', 'q'], ['q', 'p']]);
    expect(erzeugtZyklus('z', 'p', kaputt)).toBe(false);
  });
});

describe('Kanban-Einordnung', () => {
  it('fuegt an der Zielposition ein und entfernt die alte Position', () => {
    expect(kanbanEinordnen(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
    expect(kanbanEinordnen(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(kanbanEinordnen(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });
  it('klemmt ungueltige Positionen an den Rand', () => {
    expect(kanbanEinordnen(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x']);
    expect(kanbanEinordnen(['a', 'b'], 'x', -3)).toEqual(['x', 'a', 'b']);
    expect(kanbanEinordnen([], 'x', 5)).toEqual(['x']);
  });
});

describe('Zeit -> Rechnungspositionen', () => {
  const e = (id: string, kuerzel: string, datum: string, stunden: number, taetigkeit: string, ansatzChf: number | null) =>
    ({ id, mitarbeitendeId: `ma-${kuerzel}`, kuerzel, datum, stunden, taetigkeit, ansatzChf });
  const eintraege = [
    e('1', 'ml', '2026-10-02', 4, 'Workshop', 220),
    e('2', 'ph', '2026-10-01', 2.5, 'Konzept', 180),
    e('3', 'ml', '2026-10-01', 8.5, 'Konzept', 220),
    e('4', 'ml', '2026-10-03', 1, 'Konzept', 150),   // Sonderansatz -> eigene Position
  ];
  it('formatiert Stunden ohne ueberfluessige Nullen', () => {
    expect(formatStunden(12.5)).toBe('12.5');
    expect(formatStunden(8)).toBe('8');
    expect(formatStunden(0.25)).toBe('0.25');
  });
  it('gruppiert nach Mitarbeitenden (und Ansatz)', () => {
    const pos = gruppiereZeit(eintraege, 'mitarbeitende');
    expect(pos).toEqual([
      { beschreibung: 'Aufwand ml (12.5 Std)', menge: 12.5, einzelpreis: 220, eintragIds: ['1', '3'] },
      { beschreibung: 'Aufwand ml (1 Std)', menge: 1, einzelpreis: 150, eintragIds: ['4'] },
      { beschreibung: 'Aufwand ph (2.5 Std)', menge: 2.5, einzelpreis: 180, eintragIds: ['2'] },
    ]);
  });
  it('gruppiert nach Taetigkeit (und Ansatz)', () => {
    const pos = gruppiereZeit(eintraege, 'taetigkeit');
    expect(pos.map((p) => [p.beschreibung, p.menge, p.einzelpreis])).toEqual([
      ['Konzept (8.5 Std)', 8.5, 220],
      ['Konzept (2.5 Std)', 2.5, 180],
      ['Konzept (1 Std)', 1, 150],
      ['Workshop (4 Std)', 4, 220],
    ]);
  });
  it('einzeln: eine Position je Eintrag, chronologisch', () => {
    const pos = gruppiereZeit(eintraege, 'einzeln');
    expect(pos.map((p) => p.beschreibung)).toEqual([
      '01.10.2026 ml: Konzept', '01.10.2026 ph: Konzept', '02.10.2026 ml: Workshop', '03.10.2026 ml: Konzept',
    ]);
    expect(pos.every((p) => p.eintragIds.length === 1)).toBe(true);
  });
  it('summiert Viertelstunden exakt', () => {
    const pos = gruppiereZeit([e('a', 'ml', '2026-10-01', 0.1, 'X', 100), e('b', 'ml', '2026-10-01', 0.2, 'X', 100)], 'mitarbeitende');
    expect(pos[0].menge).toBe(0.3);
  });
  it('lehnt Eintraege ohne Ansatz und unbekannte Gruppierung ab', () => {
    expect(() => gruppiereZeit([e('a', 'ml', '2026-10-01', 1, 'X', null)], 'einzeln')).toThrow(ValidationError);
    expect(() => gruppiereZeit(eintraege, 'projekt' as any)).toThrow(ValidationError);
    expect(() => gruppiereZeit([], 'einzeln')).toThrow(ValidationError);
  });
});

describe('Cockpit + Ampel', () => {
  const roh = (o: Partial<CockpitRoh> = {}): CockpitRoh => ({
    projektId: 'p', budgetChf: 20000, budgetStunden: 100, aufwandBudgetChf: 5000,
    abgerechnetChf: 8000, leistungenChf: 11000, unverrechnetChf: 3000, stundenIst: 60, stundenVerrechenbar: 50,
    internKostenChf: 5400, honorareChf: 2000, aufgaben: { total: 4, erledigt: 1 }, meilensteine: [], ...o,
  });

  it('Datumshilfen', () => {
    expect(tageZwischen('2026-10-01', '2026-10-15')).toBe(14);
    expect(tageZwischen('2026-02-28', '2026-03-01')).toBe(1);
    expect(tageZwischen('2026-03-28', '2026-03-30')).toBe(2); // ueber Sommerzeit-Umstellung
    expect(heuteIso(new Date('2026-10-27T23:30:00Z'))).toBe('2026-10-28'); // Europe/Zurich
  });

  it('berechnet die Kennzahlen', () => {
    const c = berechneCockpit(roh(), '2026-10-28');
    expect(c).toMatchObject({
      abgerechnetChf: 8000, leistungenChf: 11000, unverrechnetChf: 3000, internKostenChf: 5400, honorareChf: 2000,
      deckungsbeitragChf: 600,                       // 8000 - 5400 - 2000
      budgetverbrauchProzent: 65,                    // (11000 + 2000) / 20000
      stundenverbrauchProzent: 60,
      fortschritt: { total: 4, erledigt: 1, prozent: 25 },
      meilensteine: { total: 0, erreicht: 0, ueberfaellig: 0, maxVerzugTage: 0 },
      ampel: 'gruen', ampelGruende: [],
    });
  });

  it('ohne Budget und ohne Aufgaben: keine Prozentwerte, gruen', () => {
    const c = berechneCockpit(roh({ budgetChf: null, budgetStunden: 0, aufgaben: { total: 0, erledigt: 0 } }), '2026-10-28');
    expect(c.budgetverbrauchProzent).toBeNull();
    expect(c.stundenverbrauchProzent).toBeNull();
    expect(c.fortschritt.prozent).toBe(0);
    expect(c.ampel).toBe('gruen');
  });

  it('Ampel-Schwellen Budget: >85 % gelb, >100 % rot, Grenzwerte exakt', () => {
    const mit = (leistungen: number) => berechneCockpit(roh({ leistungenChf: leistungen, honorareChf: 0 }), '2026-10-28');
    expect(mit(17000).ampel).toBe('gruen');          // genau 85 %
    expect(mit(17000.05).ampel).toBe('gelb');
    expect(mit(20000).ampel).toBe('gelb');           // genau 100 %
    const rot = mit(20000.05);
    expect(rot.ampel).toBe('rot');
    expect(rot.ampelGruende).toEqual(['Budgetverbrauch 100.0 % (> 100 %)']);
    expect(mit(18000).ampelGruende).toEqual(['Budgetverbrauch 90.0 % (> 85 %)']);
  });

  it('Ampel-Schwellen Meilensteine: ueberfaellig gelb, >14 Tage rot, erreichte zaehlen nicht', () => {
    const ms = (faelligAm: string, erreichtAm: string | null = null) => ({ titel: 'Kickoff', faelligAm, erreichtAm });
    const c1 = berechneCockpit(roh({ meilensteine: [ms('2026-10-27')] }), '2026-10-28');
    expect(c1.ampel).toBe('gelb');
    expect(c1.ampelGruende).toEqual(['Meilenstein "Kickoff" 1 Tag ueberfaellig']);
    expect(berechneCockpit(roh({ meilensteine: [ms('2026-10-14')] }), '2026-10-28').ampel).toBe('gelb');  // 14 Tage
    const c3 = berechneCockpit(roh({ meilensteine: [ms('2026-10-13'), ms('2026-09-01', '2026-09-05'), ms('2026-11-30')] }), '2026-10-28');
    expect(c3.ampel).toBe('rot');                                                                          // 15 Tage
    expect(c3.meilensteine).toEqual({ total: 3, erreicht: 1, ueberfaellig: 1, maxVerzugTage: 15 });
    expect(berechneCockpit(roh({ meilensteine: [ms('2026-10-28')] }), '2026-10-28').ampel).toBe('gruen');   // heute faellig
  });

  it('sammelt alle Gruende, rote zuerst', () => {
    const a = bewerteAmpel({ verbrauchChf: 18000, budgetChf: 20000, verzuege: [{ titel: 'Go-Live', tage: 20 }] });
    expect(a.ampel).toBe('rot');
    expect(a.gruende).toEqual(['Meilenstein "Go-Live" 20 Tage ueberfaellig (> 14)', 'Budgetverbrauch 90.0 % (> 85 %)']);
  });
});
