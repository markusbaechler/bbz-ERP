import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { erfasseZahlung } from '../src/repos/debitorRepo';
import { mahnvorschlag, mahnlauf, listMahnungen } from '../src/repos/mahnungRepo';
import { listOutbox } from '../src/repos/outboxRepo';
import { listAudit } from '../src/repos/auditRepo';
import { ValidationError } from '../src/domain/errors';

const pool = getPool();
let projektId: string; let auftraggeberId: string;

async function rechnung(datum: string, betrag: number, opts: { festschreiben?: boolean; zahlungsfristTage?: number } = {}): Promise<string> {
  const r = await createRechnung(pool, { projektId, auftraggeberId, datum });
  await addPosition(pool, r.id, { beschreibung: 'Seminar', menge: 1, einzelpreis: betrag, mwstSatz: 0 });
  if (opts.festschreiben !== false) await festschreiben(pool, r.id, 'ml');
  if (opts.zahlungsfristTage !== undefined) await pool.query('update rechnung set zahlungsfrist_tage=$2 where id=$1', [r.id, opts.zahlungsfristTage]);
  return r.id;
}

beforeAll(async () => {
  await resetDb(pool);
  auftraggeberId = (await createAuftraggeber(pool, { name: 'Musterbank AG', strasse: 'Bankweg 1', plz: '9000', ort: 'St. Gallen', email: 'kreditoren@musterbank.test' })).id;
  projektId = (await createProjekt(pool, { stammnummer: 7001, jahr: 2026, name: 'Mahn-Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

describe('mahnungRepo: Mahnvorschlag und Mahnlauf', () => {
  it('durchlaeuft Stufe 1-3 und Inkasso ueber mehrere Stichtage, idempotent', async () => {
    const id = await rechnung('2026-01-05', 1000);                 // faellig 2026-02-04
    await rechnung('2026-01-05', 500, { festschreiben: false });     // Entwurf: nie im Vorschlag
    const bezahlt = await rechnung('2026-01-05', 300);
    await erfasseZahlung(pool, bezahlt, { datum: '2026-01-20', betrag: 300 });

    expect(await mahnvorschlag(pool, '2026-02-04')).toEqual([]);

    const v1 = await mahnvorschlag(pool, '2026-02-05');
    expect(v1).toHaveLength(1);
    expect(v1[0]).toMatchObject({ rechnungId: id, faelligAm: '2026-02-04', offen: 1000, letzteStufe: null, naechsteStufe: 1, gebuehr: 0, inkasso: false });
    expect(v1[0].nummer).toMatch(/^7001\.26 - \d+ ml$/);

    const l1 = await mahnlauf(pool, { stichtag: '2026-02-05' }, 'ml');
    expect(l1.mahnungen).toHaveLength(1);
    expect(l1.mahnungen[0]).toMatchObject({ rechnungId: id, stufe: 1, bezeichnung: 'Zahlungserinnerung', datum: '2026-02-05', fristBis: '2026-02-15', gebuehrChf: 0, offenChf: 1000, erstelltDurch: 'ml' });
    expect((await mahnlauf(pool, { stichtag: '2026-02-05' })).mahnungen).toHaveLength(0);   // idempotent

    // Frist der Erinnerung laeuft noch: sichtbar, aber ohne naechste Stufe
    expect((await mahnvorschlag(pool, '2026-02-15'))[0]).toMatchObject({ letzteStufe: 1, naechsteStufe: null });
    expect((await mahnlauf(pool, { stichtag: '2026-02-15' })).mahnungen).toHaveLength(0);

    await erfasseZahlung(pool, id, { datum: '2026-02-10', betrag: 400 });
    const l2 = await mahnlauf(pool, { stichtag: '2026-02-16' }, 'ml');
    expect(l2.mahnungen[0]).toMatchObject({ stufe: 2, bezeichnung: '2. Mahnung', gebuehrChf: 50, offenChf: 600, fristBis: '2026-02-26' });

    expect((await mahnlauf(pool, { stichtag: '2026-02-27' })).mahnungen[0]).toMatchObject({ stufe: 3, bezeichnung: 'Letzte Mahnung', fristBis: '2026-03-09' });
    expect((await mahnvorschlag(pool, '2026-03-09'))[0]).toMatchObject({ letzteStufe: 3, naechsteStufe: null, inkasso: false });
    expect((await mahnvorschlag(pool, '2026-03-10'))[0]).toMatchObject({ letzteStufe: 3, naechsteStufe: null, gebuehr: 0, inkasso: true });
    expect((await mahnlauf(pool, { stichtag: '2026-03-10' })).mahnungen).toHaveLength(0);

    expect((await listMahnungen(pool, id)).map((m) => m.stufe)).toEqual([1, 2, 3]);

    // je Mahnung ein Mail-Auftrag (Outbox) und Audit
    const mails = (await listOutbox(pool, { typ: 'mail' })).filter((m) => m.payload.vorlage === 'mahnung');
    expect(mails).toHaveLength(3);
    expect(mails.map((m) => m.payload.an)).toEqual(['kreditoren@musterbank.test', 'kreditoren@musterbank.test', 'kreditoren@musterbank.test']);
    expect(mails.map((m) => m.payload.daten).sort((a, b) => a.stufe - b.stufe)).toEqual([1, 2, 3].map((stufe) => ({ rechnungId: id, stufe })));
    expect((await listAudit(pool, 'rechnung', id)).filter((a) => a.aktion === 'mahnung.erstellt')).toHaveLength(3);

    // vollstaendig bezahlt -> faellt aus dem Vorschlag
    await erfasseZahlung(pool, id, { datum: '2026-03-12', betrag: 600 });
    expect(await mahnvorschlag(pool, '2026-03-12')).toEqual([]);
  });

  it('beschraenkt den Lauf auf rechnungIds und beachtet die Zahlungsfrist je Rechnung', async () => {
    const a = await rechnung('2026-04-01', 200, { zahlungsfristTage: 10 });   // faellig 2026-04-11
    const b = await rechnung('2026-04-01', 300);                              // faellig 2026-05-01
    expect((await mahnvorschlag(pool, '2026-04-12')).map((p) => p.rechnungId)).toEqual([a]);
    const v = await mahnvorschlag(pool, '2026-05-02');
    expect(v.map((p) => p.rechnungId)).toEqual([a, b]);
    const lauf = await mahnlauf(pool, { stichtag: '2026-05-02', rechnungIds: [b] });
    expect(lauf.mahnungen.map((m) => m.rechnungId)).toEqual([b]);
    expect(await listMahnungen(pool, a)).toEqual([]);
    await expect(mahnlauf(pool, { stichtag: '2026-05-02', rechnungIds: 'x' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(mahnlauf(pool, { stichtag: '02.05.2026' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('parallele Mahnlaeufe erzeugen jede Stufe nur einmal', async () => {
    const id = await rechnung('2026-06-01', 750);
    const [x, y] = await Promise.all([mahnlauf(pool, { stichtag: '2026-07-15', rechnungIds: [id] }), mahnlauf(pool, { stichtag: '2026-07-15', rechnungIds: [id] })]);
    expect(x.mahnungen.length + y.mahnungen.length).toBe(1);
    expect(await listMahnungen(pool, id)).toHaveLength(1);
  });
});
