import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createKonto } from '../src/repos/kontoRepo';
import { createMitarbeitende } from '../src/repos/mitarbeitendeRepo';
import {
  createProjekt, getProjektById, listProjekte, updateProjekt, fortsetzeProjekt,
} from '../src/repos/projektRepo';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
let ertrag: string; let aufwand: string;
beforeAll(async () => {
  await resetDb(pool);
  base = await grundbestand(pool);
  ertrag = (await createKonto(pool, { nummer: '3200', bezeichnung: 'Beratungsertrag', typ: 'Ertrag' })).id;
  aufwand = (await createKonto(pool, { nummer: '4200', bezeichnung: 'Referentenhonorare', typ: 'Aufwand' })).id;
});
afterAll(async () => { await closePool(); });

describe('projektRepo (PM-Felder)', () => {
  it('liefert die PM-Felder mit Defaults (Status laufend)', async () => {
    const p = await getProjektById(pool, base.projekt.id);
    expect(p.status).toBe('laufend');
    expect(p.projektleitungId).toBeNull();
    expect(p.budgetStunden).toBeNull();
    expect(p.aufwandkontoId).toBeNull();
  });

  it('legt ein Projekt mit PM-Feldern an', async () => {
    const p = await createProjekt(pool, {
      stammnummer: 7001, jahr: 2026, name: 'Vertriebsentwicklung AKB', auftraggeberId: base.auftraggeber.id,
      status: 'akquise', projektleitungId: base.ml.id, startDatum: '2026-03-01', endDatum: '2026-12-31',
      beschrieb: 'Coaching Kundenberatung', budgetStunden: 120, aufwandBudgetChf: 8000, aufwandkontoId: aufwand,
    });
    expect(p).toMatchObject({
      status: 'akquise', projektleitungId: base.ml.id, startDatum: '2026-03-01', endDatum: '2026-12-31',
      beschrieb: 'Coaching Kundenberatung', budgetStunden: 120, aufwandBudgetChf: 8000, aufwandkontoId: aufwand,
    });
  });

  it('PATCH aendert Stammfelder, Termine, Budgets und Leitung', async () => {
    const p = await updateProjekt(pool, base.projekt.id, {
      name: 'Testprojekt neu', budgetChf: 25000, budgetStunden: 80, projektleitungId: base.ml.id,
      startDatum: '2026-01-01', endDatum: '2026-06-30', ertragskontoId: ertrag, bereich: 'Beratung',
    });
    expect(p).toMatchObject({ name: 'Testprojekt neu', budgetChf: 25000, budgetStunden: 80, projektleitungId: base.ml.id,
      startDatum: '2026-01-01', endDatum: '2026-06-30', ertragskontoId: ertrag, bereich: 'Beratung' });
    // Teil-PATCH laesst andere Felder unveraendert
    const q = await updateProjekt(pool, base.projekt.id, { beschrieb: 'Nur Beschrieb' });
    expect(q.name).toBe('Testprojekt neu');
    expect(q.beschrieb).toBe('Nur Beschrieb');
  });

  it('PATCH validiert: Name, Zeitraum, Status nur via Statuswechsel, unbekanntes Projekt', async () => {
    await expect(updateProjekt(pool, base.projekt.id, { name: '  ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProjekt(pool, base.projekt.id, { endDatum: '2025-12-31' })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProjekt(pool, base.projekt.id, { status: 'archiviert' } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProjekt(pool, '00000000-0000-0000-0000-000000000000', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('filtert nach Status und Projektleitung', async () => {
    const ph = await createMitarbeitende(pool, { kuerzel: 'ph', nachname: 'Huber' });
    await createProjekt(pool, { stammnummer: 7002, jahr: 2026, name: 'PH-Projekt', auftraggeberId: base.auftraggeber.id, projektleitungId: ph.id });
    const akquise = await listProjekte(pool, { status: 'akquise' });
    expect(akquise.map((p) => p.stammnummer)).toEqual([7001]);
    const mehrere = await listProjekte(pool, { status: ['akquise', 'laufend'] });
    expect(mehrere.map((p) => p.stammnummer).sort()).toEqual([6231, 7001, 7002]);
    const vonPh = await listProjekte(pool, { projektleitungId: ph.id });
    expect(vonPh.map((p) => p.name)).toEqual(['PH-Projekt']);
  });

  it('Jahresfortfuehrung uebernimmt Stamm, Kontierung, Bereich und Leitung', async () => {
    const neu = await fortsetzeProjekt(pool, base.projekt.id, 2027);
    const alt = await getProjektById(pool, base.projekt.id);
    expect(neu).toMatchObject({
      nummer: '6231.27', stammnummer: 6231, jahr: 2027, name: alt.name, auftraggeberId: alt.auftraggeberId,
      ertragskontoId: ertrag, bereich: 'Beratung', projektleitungId: base.ml.id, mwstModus: alt.mwstModus, status: 'laufend',
    });
    // Budgets/Termine gelten pro Jahr und werden nicht uebernommen
    expect(neu.budgetChf).toBeNull();
    expect(neu.startDatum).toBeNull();
  });

  it('Jahresfortfuehrung: 409 wenn Stammnummer+Jahr existiert, 400 bei ungueltigem Jahr', async () => {
    await expect(fortsetzeProjekt(pool, base.projekt.id, 2027)).rejects.toBeInstanceOf(ConflictError);
    await expect(fortsetzeProjekt(pool, base.projekt.id, 27)).rejects.toBeInstanceOf(ValidationError);
  });
});
