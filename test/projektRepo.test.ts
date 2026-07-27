import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createKonto } from '../src/repos/kontoRepo';
import { createProjekt, getProjektById, listProjekte, getJahresverlauf } from '../src/repos/projektRepo';

let auftraggeberId: string; let kontoId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'bbz st.gallen ag', strasse: 'Zürcherstrasse 202', plz: '9014', ort: 'St. Gallen' })).id;
  kontoId = (await createKonto(getPool(), { nummer: '3100', bezeichnung: 'Seminarertrag', typ: 'Ertrag' })).id;
});
afterAll(async () => { await closePool(); });

describe('projektRepo', () => {
  it('bildet nummer als stammnummer.jahr2 und speichert Kontierung', async () => {
    const p = await createProjekt(getPool(), {
      stammnummer: 6231, jahr: 2026, name: 'Ausgaben/Einnahmen bbz', auftraggeberId,
      ertragskontoId: kontoId, budgetChf: 24600, budgetTage: 2.5,
    });
    expect(p.nummer).toBe('6231.26');
    expect(p.stammnummer).toBe(6231);
    expect(p.mwstModus).toBe('exkl');
    const again = await getProjektById(getPool(), p.id);
    expect(again.ertragskontoId).toBe(kontoId);
    expect(Number(again.budgetChf)).toBe(24600);
  });
  it('filtert nach Jahr', async () => {
    await createProjekt(getPool(), { stammnummer: 7575, jahr: 2025, name: 'Altprojekt', auftraggeberId });
    const y26 = await listProjekte(getPool(), { jahr: 2026 });
    expect(y26.every((p) => p.jahr === 2026)).toBe(true);
  });
  it('liefert den Jahresverlauf einer Stammnummer nach Jahr sortiert', async () => {
    await createProjekt(getPool(), { stammnummer: 6231, jahr: 2024, name: 'bbz 2024', auftraggeberId });
    await createProjekt(getPool(), { stammnummer: 6231, jahr: 2025, name: 'bbz 2025', auftraggeberId });
    const verlauf = await getJahresverlauf(getPool(), 6231);
    expect(verlauf.map((p) => p.jahr)).toEqual([2024, 2025, 2026]);
    expect(verlauf.map((p) => p.nummer)).toEqual(['6231.24', '6231.25', '6231.26']);
  });
});
