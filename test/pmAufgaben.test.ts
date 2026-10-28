import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createProjekt } from '../src/repos/projektRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { createPhase, listPhasen, updatePhase, deletePhase, getPhase } from '../src/repos/phaseRepo';
import { createMeilenstein, listMeilensteine, updateMeilenstein, setMeilensteinErreicht } from '../src/repos/meilensteinRepo';
import {
  createAufgabe, getAufgabe, updateAufgabe, deleteAufgabe, listAufgaben, verschiebeAufgabe,
} from '../src/repos/aufgabeRepo';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
let projektId: string; let anderesProjektId: string;
beforeAll(async () => {
  await resetDb(pool);
  base = await grundbestand(pool);
  projektId = base.projekt.id;
  anderesProjektId = (await createProjekt(pool, { stammnummer: 8000, jahr: 2026, name: 'Anderes', auftraggeberId: base.auftraggeber.id })).id;
});
afterAll(async () => { await closePool(); });

describe('Phasen', () => {
  it('legt Phasen mit fortlaufender Reihenfolge an und listet sie geordnet', async () => {
    const a = await createPhase(pool, projektId, { name: 'Konzept', startDatum: '2026-01-01', endDatum: '2026-02-28' });
    const b = await createPhase(pool, projektId, { name: 'Umsetzung', startDatum: '2026-03-01' });
    expect(a.reihenfolge).toBe(1);
    expect(b.reihenfolge).toBe(2);
    expect(a.status).toBe('geplant');
    await updatePhase(pool, a.id, { reihenfolge: 3 });
    expect((await listPhasen(pool, projektId)).map((p) => p.name)).toEqual(['Umsetzung', 'Konzept']);
  });
  it('validiert Name, Zeitraum, Status und Projekt', async () => {
    await expect(createPhase(pool, projektId, { name: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPhase(pool, projektId, { name: 'X', startDatum: '2026-05-01', endDatum: '2026-04-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPhase(pool, projektId, { name: 'X', startDatum: '2026-02-30' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPhase(pool, projektId, { name: 'X', status: 'pausiert' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPhase(pool, '00000000-0000-0000-0000-000000000000', { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
    const p = await createPhase(pool, projektId, { name: 'Abschluss', startDatum: '2026-11-01' });
    // Teil-PATCH wird gegen den bestehenden Start geprueft
    await expect(updatePhase(pool, p.id, { endDatum: '2026-10-01' })).rejects.toBeInstanceOf(ValidationError);
    expect((await updatePhase(pool, p.id, { endDatum: '2026-12-15', status: 'aktiv' })).status).toBe('aktiv');
  });
  it('loescht eine Phase; Aufgaben/Meilensteine verlieren nur den Phasenbezug', async () => {
    const p = await createPhase(pool, projektId, { name: 'Wegwerf' });
    const m = await createMeilenstein(pool, projektId, { titel: 'M', faelligAm: '2026-12-01', phaseId: p.id });
    const a = await createAufgabe(pool, { titel: 'A', projektId, phaseId: p.id });
    await deletePhase(pool, p.id);
    await expect(getPhase(pool, p.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getAufgabe(pool, a.id)).phaseId).toBeNull();
    expect((await listMeilensteine(pool, projektId)).find((x) => x.id === m.id)?.phaseId).toBeNull();
    await expect(deletePhase(pool, p.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Meilensteine', () => {
  it('legt an, aendert und markiert als erreicht', async () => {
    const m = await createMeilenstein(pool, projektId, { titel: 'Kickoff', faelligAm: '2026-02-01', beschreibung: 'mit GL' });
    expect(m.erreichtAm).toBeNull();
    const u = await updateMeilenstein(pool, m.id, { faelligAm: '2026-02-03' });
    expect(u.faelligAm).toBe('2026-02-03');
    const e = await setMeilensteinErreicht(pool, m.id, '2026-02-04');
    expect(e.erreichtAm).toBe('2026-02-04');
    expect((await updateMeilenstein(pool, m.id, { erreichtAm: null })).erreichtAm).toBeNull();
  });
  it('validiert Titel, Faelligkeit und Phase im selben Projekt', async () => {
    await expect(createMeilenstein(pool, projektId, { titel: 'X' } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(createMeilenstein(pool, projektId, { titel: ' ', faelligAm: '2026-01-01' })).rejects.toBeInstanceOf(ValidationError);
    const fremd = await createPhase(pool, anderesProjektId, { name: 'Fremdphase' });
    await expect(createMeilenstein(pool, projektId, { titel: 'X', faelligAm: '2026-01-01', phaseId: fremd.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(setMeilensteinErreicht(pool, '00000000-0000-0000-0000-000000000000', '2026-01-01')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Aufgaben', () => {
  it('legt Projektaufgaben an (Default offen/normal, erstellt_durch, Sortierung am Spaltenende)', async () => {
    const a = await createAufgabe(pool, { titel: 'Grobkonzept', projektId, zustaendigId: base.ml.id, faelligAm: '2026-03-01' }, { erstelltDurch: 'ml' });
    const b = await createAufgabe(pool, { titel: 'Feinkonzept', projektId });
    expect(a).toMatchObject({ status: 'offen', prioritaet: 'normal', erstelltDurch: 'ml', zustaendigId: base.ml.id, erledigtAm: null });
    expect(b.sortierung).toBeGreaterThan(a.sortierung);
  });

  it('funktioniert auch ohne Projekt als CRM-Wiedervorlage (Kontakt/Organisation)', async () => {
    const k = await createKontakt(pool, { nachname: 'Keller', email: 'keller@akb.test' });
    const w = await createAufgabe(pool, { titel: 'Nachfassen Offerte', kontaktId: k.id, zustaendigId: base.ml.id, faelligAm: '2026-10-01' });
    expect(w.projektId).toBeNull();
    expect(w.kontaktId).toBe(k.id);
    expect((await listAufgaben(pool, { kontaktId: k.id })).map((x) => x.id)).toEqual([w.id]);
    expect((await listAufgaben(pool, { ohneProjekt: true })).map((x) => x.id)).toContain(w.id);
    // Phase/Vorgaenger setzen ein Projekt voraus
    const ph = (await listPhasen(pool, projektId))[0];
    await expect(createAufgabe(pool, { titel: 'X', kontaktId: k.id, phaseId: ph.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it('erledigt setzt erledigtAm, Wiedereroeffnen loescht es', async () => {
    const a = await createAufgabe(pool, { titel: 'Erledigbar', projektId });
    const e = await updateAufgabe(pool, a.id, { status: 'erledigt' });
    expect(e.erledigtAm).not.toBeNull();
    const nochmal = await updateAufgabe(pool, a.id, { titel: 'Erledigbar (umbenannt)' });
    expect(nochmal.erledigtAm).toBe(e.erledigtAm);
    expect((await updateAufgabe(pool, a.id, { status: 'offen' })).erledigtAm).toBeNull();
  });

  it('Vorgaenger muss im selben Projekt liegen', async () => {
    const fremd = await createAufgabe(pool, { titel: 'Fremd', projektId: anderesProjektId });
    await expect(createAufgabe(pool, { titel: 'X', projektId, vorgaengerId: fremd.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAufgabe(pool, { titel: 'X', vorgaengerId: fremd.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAufgabe(pool, { titel: 'X', projektId, vorgaengerId: '00000000-0000-0000-0000-000000000000' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('verhindert Zyklen (direkt, transitiv, Selbstbezug)', async () => {
    const a = await createAufgabe(pool, { titel: 'A', projektId });
    const b = await createAufgabe(pool, { titel: 'B', projektId, vorgaengerId: a.id });
    const c = await createAufgabe(pool, { titel: 'C', projektId, vorgaengerId: b.id });
    await expect(updateAufgabe(pool, a.id, { vorgaengerId: a.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateAufgabe(pool, a.id, { vorgaengerId: b.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateAufgabe(pool, a.id, { vorgaengerId: c.id })).rejects.toBeInstanceOf(ValidationError);
    // Umhaengen ohne Zyklus ist erlaubt
    expect((await updateAufgabe(pool, c.id, { vorgaengerId: a.id })).vorgaengerId).toBe(a.id);
  });

  it('Start nur wenn Vorgaenger erledigt (409), sonst frei', async () => {
    const v = await createAufgabe(pool, { titel: 'Vorgaenger', projektId });
    const n = await createAufgabe(pool, { titel: 'Nachfolger', projektId, vorgaengerId: v.id });
    for (const status of ['in_arbeit', 'review', 'erledigt'] as const) {
      await expect(updateAufgabe(pool, n.id, { status })).rejects.toBeInstanceOf(ConflictError);
    }
    await expect(createAufgabe(pool, { titel: 'Direkt gestartet', projektId, vorgaengerId: v.id, status: 'in_arbeit' })).rejects.toBeInstanceOf(ConflictError);
    expect((await updateAufgabe(pool, n.id, { status: 'abgebrochen' })).status).toBe('abgebrochen');
    await updateAufgabe(pool, n.id, { status: 'offen' });
    await updateAufgabe(pool, v.id, { status: 'erledigt' });
    expect((await updateAufgabe(pool, n.id, { status: 'in_arbeit' })).status).toBe('in_arbeit');
    // Nachtraeglich einen offenen Vorgaenger an eine laufende Aufgabe haengen -> ebenfalls 409
    const offen = await createAufgabe(pool, { titel: 'Noch offen', projektId });
    await expect(updateAufgabe(pool, n.id, { vorgaengerId: offen.id })).rejects.toBeInstanceOf(ConflictError);
  });

  it('Projektwechsel nur ohne Nachfolger', async () => {
    const v = await createAufgabe(pool, { titel: 'Basis', projektId });
    await createAufgabe(pool, { titel: 'Folge', projektId, vorgaengerId: v.id });
    await expect(updateAufgabe(pool, v.id, { projektId: anderesProjektId })).rejects.toBeInstanceOf(ValidationError);
  });

  it('validiert Titel, Status, Prioritaet und Daten', async () => {
    await expect(createAufgabe(pool, { titel: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAufgabe(pool, { titel: 'X', status: 'parkiert' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAufgabe(pool, { titel: 'X', prioritaet: 'mittel' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAufgabe(pool, { titel: 'X', startDatum: '2026-05-02', faelligAm: '2026-05-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAufgabe(pool, { titel: 'X', faelligAm: '1.5.2026' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('filtert ueberfaellig (faellig < heute, nicht erledigt/abgebrochen) mit injizierbarem Datum', async () => {
    const p = (await createProjekt(pool, { stammnummer: 8100, jahr: 2026, name: 'Filter', auftraggeberId: base.auftraggeber.id })).id;
    const alt = await createAufgabe(pool, { titel: 'alt', projektId: p, faelligAm: '2026-10-01' });
    await createAufgabe(pool, { titel: 'heute', projektId: p, faelligAm: '2026-10-28' });
    const erl = await createAufgabe(pool, { titel: 'erledigt', projektId: p, faelligAm: '2026-09-01' });
    await updateAufgabe(pool, erl.id, { status: 'erledigt' });
    const abg = await createAufgabe(pool, { titel: 'abgebrochen', projektId: p, faelligAm: '2026-09-01' });
    await updateAufgabe(pool, abg.id, { status: 'abgebrochen' });
    await createAufgabe(pool, { titel: 'ohne Termin', projektId: p });
    const ue = await listAufgaben(pool, { projektId: p, ueberfaellig: true, heute: '2026-10-28' });
    expect(ue.map((a) => a.id)).toEqual([alt.id]);
    expect((await listAufgaben(pool, { projektId: p, status: ['erledigt', 'abgebrochen'] })).length).toBe(2);
    expect((await listAufgaben(pool, { projektId: p, zustaendigId: base.ml.id })).length).toBe(0);
  });

  it('loescht Aufgaben; Nachfolger verlieren den Vorgaenger', async () => {
    const v = await createAufgabe(pool, { titel: 'weg', projektId });
    const n = await createAufgabe(pool, { titel: 'bleibt', projektId, vorgaengerId: v.id });
    await deleteAufgabe(pool, v.id);
    expect((await getAufgabe(pool, n.id)).vorgaengerId).toBeNull();
    await expect(deleteAufgabe(pool, v.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Kanban-Verschieben', () => {
  let p: string;
  const spalte = async (status: string) =>
    (await listAufgaben(pool, { projektId: p, status: status as any })).sort((a, b) => a.sortierung - b.sortierung).map((a) => a.titel);
  beforeAll(async () => {
    p = (await createProjekt(pool, { stammnummer: 8200, jahr: 2026, name: 'Kanban', auftraggeberId: base.auftraggeber.id })).id;
    for (const t of ['A', 'B', 'C', 'D']) await createAufgabe(pool, { titel: t, projektId: p });
  });

  it('ordnet innerhalb der Spalte neu (dicht nummeriert)', async () => {
    const d = (await listAufgaben(pool, { projektId: p })).find((a) => a.titel === 'D')!;
    await verschiebeAufgabe(pool, d.id, { status: 'offen', sortierung: 1 });
    expect(await spalte('offen')).toEqual(['A', 'D', 'B', 'C']);
    const sort = (await listAufgaben(pool, { projektId: p, status: 'offen' })).map((a) => a.sortierung).sort();
    expect(sort).toEqual([0, 1, 2, 3]);
  });

  it('verschiebt in eine andere Spalte, schliesst die Luecke und setzt Status', async () => {
    const all = await listAufgaben(pool, { projektId: p });
    const b = all.find((a) => a.titel === 'B')!; const a = all.find((x) => x.titel === 'A')!;
    await verschiebeAufgabe(pool, b.id, { status: 'in_arbeit', sortierung: 0 });
    await verschiebeAufgabe(pool, a.id, { status: 'in_arbeit', sortierung: 0 });
    expect(await spalte('in_arbeit')).toEqual(['A', 'B']);
    expect(await spalte('offen')).toEqual(['D', 'C']);
    expect((await listAufgaben(pool, { projektId: p, status: 'offen' })).map((x) => x.sortierung).sort()).toEqual([0, 1]);
    const erl = await verschiebeAufgabe(pool, a.id, { status: 'erledigt', sortierung: 5 });
    expect(erl.status).toBe('erledigt');
    expect(erl.erledigtAm).not.toBeNull();
    expect(erl.sortierung).toBe(0);
  });

  it('respektiert die Vorgaengerregel und validiert die Eingabe', async () => {
    const v = await createAufgabe(pool, { titel: 'V', projektId: p });
    const n = await createAufgabe(pool, { titel: 'N', projektId: p, vorgaengerId: v.id });
    await expect(verschiebeAufgabe(pool, n.id, { status: 'review', sortierung: 0 })).rejects.toBeInstanceOf(ConflictError);
    expect((await getAufgabe(pool, n.id)).status).toBe('offen');   // Rollback
    await expect(verschiebeAufgabe(pool, n.id, { status: 'weg' as any, sortierung: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(verschiebeAufgabe(pool, n.id, { status: 'offen', sortierung: 'x' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(verschiebeAufgabe(pool, '00000000-0000-0000-0000-000000000000', { status: 'offen', sortierung: 0 })).rejects.toBeInstanceOf(NotFoundError);
  });
});
