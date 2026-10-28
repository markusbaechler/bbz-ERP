import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createKontakt, updateKontakt, listKontakte, listNewsletterEmpfaenger } from '../src/repos/kontaktRepo';
import { createOrganisation } from '../src/repos/organisationRepo';
import { ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); });
afterAll(async () => { await closePool(); });

describe('kontakt: erweiterte Listenfilter', () => {
  it('filtert nach Interesse, Betreuer, Newsletter und bestehenden Filtern', async () => {
    const org = await createOrganisation(pool, { name: 'Filterbank' });
    await createKontakt(pool, { nachname: 'Ammann', vorname: 'Andrea', organisationId: org.id, interessen: ['zertifizierung', 'weiterbildung'], betreuerId: base.ml.id });
    await createKontakt(pool, { nachname: 'Bucher', interessen: ['nachwuchs'], newsletter: true, email: 'bucher@x.test' });
    await createKontakt(pool, { nachname: 'Christen', organisationId: org.id });

    expect((await listKontakte(pool, { interesse: 'zertifizierung' })).map((k) => k.nachname)).toEqual(['Ammann']);
    expect((await listKontakte(pool, { betreuerId: base.ml.id })).map((k) => k.nachname)).toEqual(['Ammann']);
    expect((await listKontakte(pool, { newsletter: true })).map((k) => k.nachname)).toEqual(['Bucher']);
    expect((await listKontakte(pool, { newsletter: false })).map((k) => k.nachname)).toEqual(['Ammann', 'Christen']);
    expect((await listKontakte(pool, { organisationId: org.id, suche: 'chr' })).map((k) => k.nachname)).toEqual(['Christen']);
    await expect(listKontakte(pool, { interesse: 'golf' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('kontakt: Newsletter-Empfaenger (nDSG)', () => {
  it('nur Newsletter + Einwilligung + aktiv + E-Mail; mit Organisationsname', async () => {
    const org = await createOrganisation(pool, { name: 'Newsletterbank' });
    await createKontakt(pool, { nachname: 'Zeller', vorname: 'Zoe', anrede: 'Frau', email: 'z.zeller@nl.test', newsletter: true, organisationId: org.id });
    const ohneEinwilligung = await createKontakt(pool, { nachname: 'Ohne', email: 'ohne@nl.test', newsletter: true });
    await pool.query('update kontakt set einwilligung_am=null where id=$1', [ohneEinwilligung.id]);
    const archiviert = await createKontakt(pool, { nachname: 'Archiv', email: 'archiv@nl.test', newsletter: true });
    await updateKontakt(pool, archiviert.id, { archiviert: true });
    const abgemeldet = await createKontakt(pool, { nachname: 'Abmelder', email: 'ab@nl.test', newsletter: true });
    await updateKontakt(pool, abgemeldet.id, { newsletter: false });
    await createKontakt(pool, { nachname: 'Ohnemail', newsletter: true });

    const l = await listNewsletterEmpfaenger(pool);
    expect(l).toEqual([
      { email: 'bucher@x.test', anrede: null, vorname: null, nachname: 'Bucher', organisation: null },
      { email: 'z.zeller@nl.test', anrede: 'Frau', vorname: 'Zoe', nachname: 'Zeller', organisation: 'Newsletterbank' },
    ]);
  });
});
