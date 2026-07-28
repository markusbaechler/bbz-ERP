import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { leseKonten, importKonten } from '../src/migration/konten';
import { findKontoByNummer, listKonten } from '../src/repos/kontoRepo';

// Ausschnitt aus dem echten Kundenkontenplan ("Kontoplan 2024.xlsx", Blatt
// Erfolgsrechnung): 15 Kontozeilen — genau die, die der Projekt-Export belegt —
// plus die Gruppen-, Banner- und Leerzeilen, die dazwischenstehen. Die Bezeichnungen
// sind unveraendert aus der Quelle uebernommen; nichts daran ist abgeleitet.
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/kontoplan_mini.csv');
const text = () => readFileSync(fixture, 'utf8');

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('leseKonten', () => {
  // Der Kopf des Blatts laeuft ueber zwei Zeilen ("MWST-" / "Code"); die erste
  // Datenzeile steht nicht auf Zeile 1. Wer das uebersieht, liest den halben Kopf
  // als Datensatz ein.
  it('findet den Kopf trotz der zweizeiligen Ueberschrift', () => {
    const r = leseKonten(text());
    expect(r.konten[0].nummer).toBe('3010');
    expect(r.konten[0].bezeichnung).toBe('IGK / mittleres und oberes Kader');
  });

  it('nimmt nur 4- und 5-stellige Nummern als Konto und ueberspringt Gruppen und Banner', () => {
    const r = leseKonten(text());
    expect(r.konten).toHaveLength(15);
    expect(r.zeilenGesamt).toBe(30);
    expect(r.uebersprungen).toBe(15);
    // Gruppen ("3", "30", "301", "320") und Banner ("E r f o l g s r e c h n u n g",
    // "Total ...") duerfen nirgends als Konto auftauchen.
    const nummern = r.konten.map((k) => k.nummer);
    expect(nummern).not.toContain('3');
    expect(nummern).not.toContain('30');
    expect(nummern).not.toContain('301');
    expect(nummern).not.toContain('320');
    expect(nummern.every((n) => /^\d{4,5}$/.test(n))).toBe(true);
  });

  // Die fuenfstelligen Nummern sind keine Fehler: der Kontenplan ist
  // MWSt-differenziert, eine angehaengte 1 ergibt den Zwilling des vierstelligen
  // Kontos fuer die andere MWSt-Behandlung.
  it('liest die fuenfstelligen MWSt-Zwillinge mit ihrer echten Bezeichnung', () => {
    const k = new Map(leseKonten(text()).konten.map((x) => [x.nummer, x]));
    expect(k.get('3100')!.bezeichnung).toBe('Ausbildung von Lernenden');
    expect(k.get('31001')!.bezeichnung).toBe('Ausbildung von Lernenden 7.7%');
    expect(k.get('3102')!.bezeichnung).toBe('Weiterentwicklung');
    expect(k.get('31021')!.bezeichnung).toBe('Weiterentwicklung 7.7%');
    expect(k.get('3200')!.bezeichnung).toBe('B+V / Zertifizierungen ohne SAQ');
    expect(k.get('32001')!.bezeichnung).toBe('Beratungs- und Verkaufsprozesse 0%');
    expect(k.get('3204')!.bezeichnung).toBe('SAQ Zertifizierung');
    expect(k.get('32041')!.bezeichnung).toBe('Lizenzschulung 0%');
  });

  it('leitet den Typ aus der fuehrenden Ziffer ab und traegt den MWST-Code roh mit', () => {
    const k = new Map(leseKonten(text()).konten.map((x) => [x.nummer, x]));
    expect(k.get('3010')!.typ).toBe('Ertrag');
    expect(k.get('32041')!.typ).toBe('Ertrag');
    expect(k.get('5000')!.typ).toBe('Aufwand');
    expect(k.get('5200')!.typ).toBe('Aufwand');

    expect(k.get('3010')!.mwstCode).toBe('700');
    expect(k.get('31001')!.mwstCode).toBe('510');
    expect(k.get('32001')!.mwstCode).toBe('U00');
    expect(k.get('3700')!.mwstCode).toBe('520');
    // 49 der 177 Konten fuehren keinen Code — der bleibt leer, statt geraten zu werden.
    expect(k.get('5000')!.mwstCode).toBeNull();
  });

  // Der Export von 2024 fuehrt kein einziges inaktives Konto. Die Spalte ist trotzdem
  // da und wird ausgewertet — hier an einer synthetisch gesetzten Markierung auf einer
  // sonst unveraenderten Zeile der Quelle, damit der Pfad nicht ungeprueft bleibt.
  it('wertet "Inaktiv" auf aktiv=false aus, ohne die Zeile zu verwerfen', () => {
    expect(leseKonten(text()).konten.every((k) => k.aktiv)).toBe(true);

    const markiert = text().replace(
      '3204;SAQ Zertifizierung;3204;CHF;;510;',
      '3204;SAQ Zertifizierung;3204;CHF;X;510;');
    const k = new Map(leseKonten(markiert).konten.map((x) => [x.nummer, x]));
    expect(k.get('3204')!.aktiv).toBe(false);
    // Stillgelegt heisst nicht weg: historische Projekte verweisen darauf.
    expect(k.get('3204')!.bezeichnung).toBe('SAQ Zertifizierung');
    expect(k.get('3204')!.mwstCode).toBe('510');
  });

  it('meldet eine doppelte Kontonummer, statt sie still zu ueberschreiben', () => {
    const doppelt = text() + '3010;Zweite Zeile zur selben Nummer;3010;CHF;;700;;;;;;;\n';
    const r = leseKonten(doppelt);
    expect(r.konten).toHaveLength(15);
    expect(r.warnungen.some((w) => w.includes('3010'))).toBe(true);
  });
});

describe('importKonten', () => {
  it('schreibt im Dry-Run nichts', async () => {
    const r = await importKonten(getPool(), { quelle: fixture, text: text(), modus: 'dry-run' });
    expect(r.gelesen).toBe(15);
    expect(r.angelegt).toBe(15);          // was ein --apply anlegen wuerde
    expect(await listKonten(getPool())).toHaveLength(0);
  });

  it('legt die Konten an und ist beim zweiten Lauf idempotent', async () => {
    const erst = await importKonten(getPool(), { quelle: fixture, text: text(), modus: 'apply' });
    expect(erst.zeilenGesamt).toBe(30);
    expect(erst.gelesen).toBe(15);
    expect(erst.uebersprungen).toBe(15);
    expect(erst.angelegt).toBe(15);
    expect(erst.aktualisiert).toBe(0);
    expect(await listKonten(getPool())).toHaveLength(15);

    const zweit = await importKonten(getPool(), { quelle: fixture, text: text(), modus: 'apply' });
    expect(zweit.angelegt).toBe(0);
    expect(zweit.aktualisiert).toBe(15);
    expect(await listKonten(getPool())).toHaveLength(15);
  });

  it('schreibt Bezeichnung, Typ und MWST-Code in die Datenbank', async () => {
    await importKonten(getPool(), { quelle: fixture, text: text(), modus: 'apply' });
    const k = await findKontoByNummer(getPool(), '31001');
    expect(k?.bezeichnung).toBe('Ausbildung von Lernenden 7.7%');
    expect(k?.typ).toBe('Ertrag');
    expect(k?.mwstCode).toBe('510');
    expect(k?.aktiv).toBe(true);

    const a = await findKontoByNummer(getPool(), '5200');
    expect(a?.bezeichnung).toBe('Externe Zertifizierung 0.0%');
    expect(a?.typ).toBe('Aufwand');
    expect(a?.mwstCode).toBeNull();
  });

  // Der Kontenplan ist die Quelle: aendert der Kunde eine Bezeichnung, gewinnt sie.
  it('uebernimmt eine geaenderte Bezeichnung beim naechsten Lauf', async () => {
    await importKonten(getPool(), { quelle: fixture, text: text(), modus: 'apply' });
    const geaendert = text().replace('3204;SAQ Zertifizierung;', '3204;SAQ Zertifizierung neu;');
    await importKonten(getPool(), { quelle: fixture, text: geaendert, modus: 'apply' });
    expect((await findKontoByNummer(getPool(), '3204'))?.bezeichnung).toBe('SAQ Zertifizierung neu');
  });
});
