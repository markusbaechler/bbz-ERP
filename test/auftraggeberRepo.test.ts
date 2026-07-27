import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber, getAuftraggeberById } from '../src/repos/auftraggeberRepo';
import { ValidationError } from '../src/domain/errors';

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
