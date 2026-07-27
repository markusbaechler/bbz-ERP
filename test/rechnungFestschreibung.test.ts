import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber, upsertAuftraggeberAusMigration, updateAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { getZaehler } from '../src/repos/zaehlerRepo';
import { ValidationError } from '../src/domain/errors';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

async function draftMitPosition(): Promise<string> {
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 100, mwstSatz: 8.1 });
  return r.id;
}

describe('festschreiben', () => {
  it('vergibt lückenlose lfdNr und baut nummer', async () => {
    const a = await festschreiben(getPool(), await draftMitPosition(), 'ml');
    const b = await festschreiben(getPool(), await draftMitPosition(), 'ml');
    expect(a.lfdNr).toBe(1);
    expect(b.lfdNr).toBe(2);
    expect(a.status).toBe('abgerechnet');
    expect(a.nummer).toBe('6231.26 - 1 ml');
    expect(b.nummer).toBe('6231.26 - 2 ml');
  });
  it('verweigert Festschreibung ohne Positionen', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await expect(festschreiben(getPool(), r.id)).rejects.toBeInstanceOf(ValidationError);
  });
  it('verweigert Positionsänderung nach Festschreibung', async () => {
    const id = await draftMitPosition();
    await festschreiben(getPool(), id);
    await expect(addPosition(getPool(), id, { beschreibung: 'Y', menge: 1, einzelpreis: 1, mwstSatz: 8.1 }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  // Migrierte Auftraggeber kommen ohne Adresse an (adresse_unvollstaendig=true, Befund B3).
  // Eine Festschreibung wuerde eine unwiderrufliche Rechnungsnummer verbrauchen, obwohl
  // daraus kein zustellbarer QR-Beleg entstehen kann — darum vor dem Zaehler abbrechen.
  it('verweigert Festschreibung bei unvollstaendiger Auftraggeber-Adresse ohne eine Nummer zu verbrauchen', async () => {
    const mig = (await upsertAuftraggeberAusMigration(getPool(), { nummer: '9001', name: 'Migrierte Bank' })).auftraggeber;
    expect(mig.adresseUnvollstaendig).toBe(true);
    const p = await createProjekt(getPool(), { stammnummer: 9001, jahr: 2026, name: 'Migriert', auftraggeberId: mig.id });
    const r = await createRechnung(getPool(), { projektId: p.id, auftraggeberId: mig.id, datum: '2026-07-23' });
    await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 100, mwstSatz: 8.1 });

    const vorher = await getZaehler(getPool(), 'rechnung_lfd_nr');
    await expect(festschreiben(getPool(), r.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(festschreiben(getPool(), r.id)).rejects.toThrow(/Adresse/);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(vorher);
  });

  // Der Weg aus der Sperre heraus: die Fehlermeldung verlangt eine vollstaendige Adresse,
  // und genau die traegt updateAuftraggeber nach. Ohne diesen Test waere die Sperre eine
  // Sackgasse — jeder migrierte Auftraggeber bliebe dauerhaft nicht fakturierbar.
  it('laesst nach dem Nachtragen der Adresse festschreiben — und verbraucht dabei genau eine Nummer', async () => {
    const mig = (await upsertAuftraggeberAusMigration(getPool(), { nummer: '9002', name: 'Migrierte KB' })).auftraggeber;
    const p = await createProjekt(getPool(), { stammnummer: 9002, jahr: 2026, name: 'Migriert 2', auftraggeberId: mig.id });
    const r = await createRechnung(getPool(), { projektId: p.id, auftraggeberId: mig.id, datum: '2026-07-23' });
    await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 100, mwstSatz: 8.1 });

    const vorher = await getZaehler(getPool(), 'rechnung_lfd_nr');
    await expect(festschreiben(getPool(), r.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(vorher);

    // Die Meldung nennt den Weg, der jetzt existiert.
    await expect(festschreiben(getPool(), r.id)).rejects.toThrow(/PUT \/auftraggeber/);

    await updateAuftraggeber(getPool(), mig.id, { strasse: 'Bahnhofstrasse 1', plz: '6460', ort: 'Altdorf' });

    const f = await festschreiben(getPool(), r.id);
    expect(f.status).toBe('abgerechnet');
    expect(f.lfdNr).toBe(vorher + 1);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(vorher + 1);
  });

  it('laesst Festschreibung fuer regulaer erfasste Auftraggeber unveraendert zu', async () => {
    const vorher = await getZaehler(getPool(), 'rechnung_lfd_nr');
    const f = await festschreiben(getPool(), await draftMitPosition());
    expect(f.lfdNr).toBe(vorher + 1);
  });
});
