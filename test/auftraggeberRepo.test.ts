import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import {
  createAuftraggeber, getAuftraggeberById, updateAuftraggeber, upsertAuftraggeberAusMigration,
} from '../src/repos/auftraggeberRepo';
import { ValidationError, NotFoundError } from '../src/domain/errors';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('auftraggeberRepo', () => {
  it('legt Auftraggeber mit vollständiger Adresse an', async () => {
    const a = await createAuftraggeber(getPool(), {
      nummer: '20577', name: 'Urner Kantonalbank',
      strasse: 'Bahnhofstrasse 1', plz: '6460', ort: 'Altdorf',
    });
    expect(a.land).toBe('CH');
    const again = await getAuftraggeberById(getPool(), a.id);
    expect(again.name).toBe('Urner Kantonalbank');
  });
  it('verweigert unvollständige Adresse', async () => {
    await expect(createAuftraggeber(getPool(), {
      name: 'Ohne Ort', strasse: 'X', plz: '', ort: '',
    })).rejects.toBeInstanceOf(ValidationError);
  });
});

// Migrierte Auftraggeber kommen mit adresse_unvollstaendig=true an und sind damit nicht
// fakturierbar (siehe festschreiben). Ohne einen Weg, die Adresse nachzutragen, blieben sie
// es dauerhaft. updateAuftraggeber ist dieser Weg — und leitet das Kennzeichen aus den
// Daten ab, statt es den Aufrufer setzen zu lassen.
describe('updateAuftraggeber', () => {
  const migriert = async (nummer: string) =>
    (await upsertAuftraggeberAusMigration(getPool(), { nummer, name: `Migriert ${nummer}` })).auftraggeber;

  it('loescht adresse_unvollstaendig, sobald Strasse, PLZ und Ort gefuellt sind', async () => {
    const a = await migriert('40001');
    expect(a.adresseUnvollstaendig).toBe(true);
    const u = await updateAuftraggeber(getPool(), a.id, {
      strasse: 'Bahnhofstrasse 1', plz: '6460', ort: 'Altdorf', email: 'kb@example.ch',
    });
    expect(u.adresseUnvollstaendig).toBe(false);
    expect(u.strasse).toBe('Bahnhofstrasse 1');
    expect(u.email).toBe('kb@example.ch');
    expect((await getAuftraggeberById(getPool(), a.id)).adresseUnvollstaendig).toBe(false);
  });

  it('laesst das Kennzeichen bei unvollstaendiger Adresse stehen', async () => {
    const a = await migriert('40002');
    const u = await updateAuftraggeber(getPool(), a.id, { strasse: 'Bahnhofstrasse 1' });
    expect(u.strasse).toBe('Bahnhofstrasse 1');
    expect(u.adresseUnvollstaendig).toBe(true);
    const u2 = await updateAuftraggeber(getPool(), a.id, { plz: '6460' });
    expect(u2.adresseUnvollstaendig).toBe(true);
    // erst mit dem Ort ist die Adresse komplett
    expect((await updateAuftraggeber(getPool(), a.id, { ort: 'Altdorf' })).adresseUnvollstaendig).toBe(false);
  });

  it('laesst einen bereits vollstaendigen Auftraggeber auf false', async () => {
    const a = await createAuftraggeber(getPool(), {
      nummer: '40003', name: 'Vollstaendig AG', strasse: 'Seestrasse 2', plz: '8002', ort: 'Zuerich',
    });
    expect(a.adresseUnvollstaendig).toBe(false);
    const u = await updateAuftraggeber(getPool(), a.id, { telefon: '041 000 00 00' });
    expect(u.adresseUnvollstaendig).toBe(false);
    expect(u.telefon).toBe('041 000 00 00');
  });

  // Das Kennzeichen darf nie ohne echte Adresse verschwinden: ein leerer Wert wird
  // zurueckgewiesen, statt eine vorhandene Adresse zu loeschen.
  it('weist leere Pflichtfelder zurueck', async () => {
    const a = await migriert('40004');
    for (const feld of ['name', 'strasse', 'plz', 'ort', 'land'] as const) {
      await expect(updateAuftraggeber(getPool(), a.id, { [feld]: '  ' }))
        .rejects.toBeInstanceOf(ValidationError);
    }
    await expect(updateAuftraggeber(getPool(), a.id, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('wirft NotFoundError bei unbekannter id', async () => {
    await expect(updateAuftraggeber(getPool(), '00000000-0000-0000-0000-000000000000', { ort: 'Altdorf' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
