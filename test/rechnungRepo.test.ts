import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, getRechnung, listPositionen } from '../src/repos/rechnungRepo';
import { rappenRunden } from '../src/domain/mwst';
import { ValidationError } from '../src/domain/errors';
import { erzeugeRechnungPdf } from '../src/pdf/rechnungPdf';
import { getAuftraggeberById } from '../src/repos/auftraggeberRepo';
import { extrahierePdfText } from './helpers/pdfText';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

describe('rechnungRepo', () => {
  it('erstellt Draft und berechnet Totale aus Positionen (exkl, Rappenrundung)', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', betreff: 'Verrechnung', mwstModus: 'exkl' });
    expect(r.status).toBe('offen_prov');
    expect(r.lfdNr).toBeNull();

    await addPosition(getPool(), r.id, { beschreibung: '33.5 Std. à 230.00', menge: 33.5, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' });
    const updated = await getRechnung(getPool(), r.id);
    expect(Number(updated.totalNetto)).toBe(7705);
    expect(Number(updated.totalMwst)).toBe(624.10);
    expect(Number(updated.totalBrutto)).toBe(8329.10);
  });
});

// Befund C1: menge und einzelpreis stehen als numeric(12,2) in der Datenbank.
// Wurde der Betrag aus den *ungerundeten* Eingaben gerechnet, druckte der Beleg
// drei Zahlen, die nicht miteinander aufgehen (33.555 x 230.00 = 7717.65,
// gespeichert aber 33.56 x 230.00 = 7718.80). Die Rechnung ist nach der
// Festschreibung unwiderruflich, deshalb wird die Eingabe abgewiesen, statt im
// Stillen gerundet zu werden.
describe('Positionen mit mehr als zwei Nachkommastellen', () => {
  it('weist eine dreistellige Menge mit deutscher Meldung ab', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-28' });
    await expect(addPosition(getPool(), r.id, { beschreibung: 'Beratung', menge: 33.555, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' }))
      .rejects.toThrow(ValidationError);
    await expect(addPosition(getPool(), r.id, { beschreibung: 'Beratung', menge: 33.555, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' }))
      .rejects.toThrow(/menge.*Nachkommastellen/i);
    expect(await listPositionen(getPool(), r.id)).toHaveLength(0);
  });

  it('weist einen dreistelligen Einzelpreis ab', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-28' });
    await expect(addPosition(getPool(), r.id, { beschreibung: 'Kopien', menge: 5000, einzelpreis: 0.085, mwstSatz: 8.1, einheit: 'Stk' }))
      .rejects.toThrow(/einzelpreis.*Nachkommastellen/i);
  });

  it('was gespeichert ist und was gedruckt wird, geht miteinander auf', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-28', mwstModus: 'exkl' });
    await addPosition(getPool(), r.id, { beschreibung: 'Beratung', menge: 33.56, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' });
    const [pos] = await listPositionen(getPool(), r.id);
    expect(rappenRunden(pos.menge * pos.einzelpreis)).toBe(pos.betragNetto);
    expect(pos.betragNetto).toBe(7718.8);

    // Gedruckt wird aus denselben gespeicherten Werten. Der Zahlteil verlangt eine
    // vergebene lfd_nr; die Festschreibung selbst ist hier nicht der Gegenstand,
    // darum wird der Kopf der Rechnung dafuer ergaenzt.
    const kopf = { ...(await getRechnung(getPool(), r.id)), lfdNr: 33214, nummer: '6231.26 - 33214 ml' };
    const auftraggeber = await getAuftraggeberById(getPool(), auftraggeberId);
    const gedruckt = extrahierePdfText(await erzeugeRechnungPdf(kopf, [pos], auftraggeber));
    expect(gedruckt).toContain('33.56 Std à 230.00');
    expect(gedruckt).toContain('7718.80');
  });
});

// Befund I2: der Positions-Endpunkt war der einzige Schreibpfad ohne Pruefung —
// eine leere oder unlesbare Eingabe endete als 500 „Internal Server Error"
// (numeric-not-null-Verletzung) statt als 400 mit deutschem Klartext.
describe('Pflichtfelder einer Position', () => {
  let rechnungId: string;
  beforeAll(async () => {
    rechnungId = (await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-28' })).id;
  });

  const abweisen = (p: any, muster: RegExp) =>
    expect(addPosition(getPool(), rechnungId, p)).rejects.toThrow(muster);

  it('weist eine unlesbare Menge ab (NaN aus „33,5" wird zu null)', () =>
    abweisen({ beschreibung: 'X', menge: null, einzelpreis: 10, mwstSatz: 8.1 }, /Feld menge/));
  it('weist NaN als Menge ab', () =>
    abweisen({ beschreibung: 'X', menge: NaN, einzelpreis: 10, mwstSatz: 8.1 }, /Feld menge/));
  it('weist eine Menge von 0 ab', () =>
    abweisen({ beschreibung: 'X', menge: 0, einzelpreis: 10, mwstSatz: 8.1 }, /Feld menge/));
  it('weist einen Einzelpreis von 0 ab (sonst stille CHF-0.00-Zeile)', () =>
    abweisen({ beschreibung: 'X', menge: 1, einzelpreis: 0, mwstSatz: 8.1 }, /Feld einzelpreis/));
  it('weist einen leeren Einzelpreis ab', () =>
    abweisen({ beschreibung: 'X', menge: 1, einzelpreis: null, mwstSatz: 8.1 }, /Feld einzelpreis/));
  it('weist eine leere Beschreibung ab (sonst stille Leerzeile)', () =>
    abweisen({ beschreibung: '   ', menge: 1, einzelpreis: 10, mwstSatz: 8.1 }, /Feld beschreibung/));
  it('weist einen fehlenden MWSt-Satz ab', () =>
    abweisen({ beschreibung: 'X', menge: 1, einzelpreis: 10, mwstSatz: null }, /Feld mwstSatz/));

  it('nimmt eine saubere Position an und speichert die Beschreibung getrimmt', async () => {
    const p = await addPosition(getPool(), rechnungId, { beschreibung: '  Seminarleitung  ', menge: 1, einzelpreis: 10, mwstSatz: 8.1 });
    expect(p.beschreibung).toBe('Seminarleitung');
  });
});
