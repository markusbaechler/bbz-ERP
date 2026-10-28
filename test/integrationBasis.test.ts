import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { FakeMoodle } from './helpers/fakeMoodle';
import { MoodleClient, MoodleFehler, flachParameter, benutzernameAusEmail } from '../src/integrations/moodle/client';
import { moodleEinschreiben, moodleAusschreiben, abschlussSync } from '../src/integrations/moodle/sync';
import { signiere, pruefeSignatur } from '../src/integrations/webhooks';
import { GraphMailAdapter, ProtokollMailAdapter } from '../src/integrations/mail';
import { rendereMail } from '../src/integrations/mailVorlagen';
import { standardHandler, verarbeiteOutbox } from '../src/integrations/worker';
import { enqueue, publiziere, listOutbox } from '../src/repos/outboxRepo';
import { createKontakt } from '../src/repos/kontaktRepo';

const pool = getPool();
let fake: FakeMoodle; let moodle: MoodleClient;
let base: Awaited<ReturnType<typeof grundbestand>>;

/** Legt Kursangebot + Durchfuehrung (mit Moodle-Kurs) + Anmeldung per SQL an (Bildungs-Repos sind ein eigenes Modul). */
async function anmeldung(opts: { email?: string | null; status?: string; moodleKursId?: number | null } = {}) {
  const ka = await pool.query(`insert into kursangebot(code,titel,bereich,lernstunden) values ($1,'Eigenheimfinanzierung','Banking',36) returning id`, [`K${Math.random().toString(36).slice(2, 7)}`]);
  const d = await pool.query(`insert into durchfuehrung(kursangebot_id,projekt_id,code,start_datum,end_datum,ort,moodle_kurs_id,status)
    values ($1,$2,$3,'2026-11-10','2026-11-12','Zürich',$4,'ausgeschrieben') returning id`, [ka.rows[0].id, base.projekt.id, `BEF-${Math.random().toString(36).slice(2, 6)}`, opts.moodleKursId === undefined ? 42 : opts.moodleKursId]);
  await pool.query(`insert into kurstag(durchfuehrung_id,datum,von,bis) values ($1,'2026-11-10','08:30','17:00')`, [d.rows[0].id]);
  const k = await createKontakt(pool, { anrede: 'Frau', vorname: 'Erika', nachname: 'Beispiel', email: opts.email === null ? null : opts.email ?? `erika.${Math.random().toString(36).slice(2, 7)}@bank.test` });
  const a = await pool.query(`insert into anmeldung(durchfuehrung_id,kontakt_id,status) values ($1,$2,$3) returning id`, [d.rows[0].id, k.id, opts.status ?? 'bestaetigt']);
  return { anmeldungId: a.rows[0].id as string, kontaktId: k.id, durchfuehrungId: d.rows[0].id as string };
}

beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); });
beforeEach(() => { fake = new FakeMoodle(); moodle = new MoodleClient({ url: 'https://moodle.test/', token: fake.token, fetch: fake.fetch }); });
afterAll(async () => { await closePool(); });

describe('Moodle-Client', () => {
  it('flacht Parameter im PHP-Array-Format ab', () => {
    expect(flachParameter({ users: [{ email: 'a@b.c', createpassword: true }], courseid: 3 }))
      .toEqual({ 'users[0][email]': 'a@b.c', 'users[0][createpassword]': '1', courseid: '3' });
    expect(benutzernameAusEmail(' Erika.Muster+x@Bank.ch ')).toBe('erika.musterx@bank.ch');
  });
  it('liefert Moodle-Fehler als MoodleFehler (auch bei HTTP 200)', async () => {
    const falsch = new MoodleClient({ url: 'https://moodle.test', token: 'falsch', fetch: fake.fetch });
    await expect(falsch.siteInfo()).rejects.toMatchObject({ errorcode: 'invalidtoken' });
    fake.ausfall = true;
    await expect(moodle.siteInfo()).rejects.toMatchObject({ temporaer: true });
  });
  it('findet oder legt Benutzer an und schreibt ein/aus', async () => {
    expect(await moodle.findeBenutzerPerEmail('neu@bank.test')).toBeNull();
    const id = await moodle.erstelleBenutzer({ email: 'Neu@Bank.test', vorname: 'Neu', nachname: 'Person' });
    expect((await moodle.findeBenutzerPerEmail('neu@bank.test'))?.id).toBe(id);
    await moodle.schreibeEin({ userid: id, courseid: 7 });
    expect(fake.enrolments).toEqual([{ userid: id, courseid: 7, roleid: 5, timestart: undefined, timeend: undefined }]);
    await moodle.schreibeAus({ userid: id, courseid: 7 });
    expect(fake.enrolments).toHaveLength(0);
  });
  it('meldet "kein Abschluss konfiguriert" als null', async () => {
    fake.ohneKriterien.add(9);
    expect(await moodle.abschluss(9, 1)).toBeNull();
    fake.completed.set('8:1', 1_790_000_000);
    expect(await moodle.abschluss(8, 1)).toEqual({ abgeschlossen: true, zeitpunkt: 1_790_000_000 });
  });
});

describe('Moodle-Sync', () => {
  it('schreibt bestaetigte Anmeldung ein: Benutzer anlegen, Zeitfenster, Status, moodle_user_id', async () => {
    const { anmeldungId, kontaktId } = await anmeldung();
    expect(await moodleEinschreiben(pool, moodle, anmeldungId)).toBe('eingeschrieben');
    const e = fake.enrolments[0];
    expect(e.courseid).toBe(42);
    expect(e.timestart).toBe(Date.parse('2026-10-27T00:00:00Z') / 1000);       // 14 Tage vor Beginn
    expect(e.timeend).toBe(Date.parse('2027-01-11T00:00:00Z') / 1000);         // 60 Tage nach Ende
    const k = await pool.query('select moodle_user_id from kontakt where id=$1', [kontaktId]);
    expect(k.rows[0].moodle_user_id).toBe(e.userid);
    expect((await pool.query('select moodle_status from anmeldung where id=$1', [anmeldungId])).rows[0].moodle_status).toBe('eingeschrieben');
    // idempotent: zweiter Lauf legt keinen weiteren Benutzer an
    await moodleEinschreiben(pool, moodle, anmeldungId);
    expect(fake.users).toHaveLength(1);
  });
  it('vergibt eine Moodle-ID nicht doppelt, schreibt aber trotzdem ein', async () => {
    const alt = await createKontakt(pool, { nachname: 'Archiv', email: 'archiv@bank.test' });
    await pool.query('update kontakt set moodle_user_id=555, archiviert=true where id=$1', [alt.id]);
    fake.users.push({ id: 555, username: 'dop', email: 'dop@bank.test', firstname: 'D', lastname: 'P' });
    const { anmeldungId, kontaktId } = await anmeldung({ email: 'dop@bank.test' });
    expect(await moodleEinschreiben(pool, moodle, anmeldungId)).toBe('eingeschrieben');
    expect((await pool.query('select moodle_user_id from kontakt where id=$1', [kontaktId])).rows[0].moodle_user_id).toBeNull();
  });
  it('nutzt bestehende (selbstregistrierte) Moodle-Konten ueber die E-Mail', async () => {
    fake.users.push({ id: 7, username: 'selbst', email: 'selbst@bank.test', firstname: 'S', lastname: 'R' });
    const { anmeldungId } = await anmeldung({ email: 'Selbst@Bank.test' });
    await moodleEinschreiben(pool, moodle, anmeldungId);
    expect(fake.enrolments[0].userid).toBe(7);
    expect(fake.aufrufe.some((a) => a.wsfunction === 'core_user_create_users')).toBe(false);
  });
  it('ueberspringt nicht bestaetigte Anmeldungen und Durchfuehrungen ohne Moodle-Kurs', async () => {
    expect(await moodleEinschreiben(pool, moodle, (await anmeldung({ status: 'angemeldet' })).anmeldungId)).toBe('uebersprungen');
    const ohne = await anmeldung({ moodleKursId: null });
    expect(await moodleEinschreiben(pool, moodle, ohne.anmeldungId)).toBe('uebersprungen');
    expect((await pool.query('select moodle_status from anmeldung where id=$1', [ohne.anmeldungId])).rows[0].moodle_status).toBe('nicht_relevant');
  });
  it('vermerkt Fehler an der Anmeldung und wirft (-> Outbox-Retry)', async () => {
    const { anmeldungId } = await anmeldung();
    fake.ausfall = true;
    await expect(moodleEinschreiben(pool, moodle, anmeldungId)).rejects.toBeInstanceOf(MoodleFehler);
    const r = await pool.query('select moodle_status, moodle_fehler from anmeldung where id=$1', [anmeldungId]);
    expect(r.rows[0]).toMatchObject({ moodle_status: 'fehler' });
    expect(r.rows[0].moodle_fehler).toMatch(/nicht erreichbar/);
  });
  it('schreibt aus und synchronisiert Kursabschluesse (mit Laufprotokoll)', async () => {
    const x = await anmeldung(); const y = await anmeldung();
    await moodleEinschreiben(pool, moodle, x.anmeldungId); await moodleEinschreiben(pool, moodle, y.anmeldungId);
    const ux = fake.enrolments[0].userid;
    fake.completed.set(`42:${ux}`, 1_793_000_000);
    const abgeschlossen: string[] = [];
    const r = await abschlussSync(pool, moodle, async (_p, id) => { abgeschlossen.push(id); }, {});
    expect(r.abgeschlossen).toBe(1);
    expect(abgeschlossen).toEqual([x.anmeldungId]);
    const lauf = await pool.query(`select status from integration_lauf where typ='moodle.abschluss' order by id desc limit 1`);
    expect(lauf.rows[0].status).toBe('ok');
    expect(await moodleAusschreiben(pool, moodle, y.anmeldungId)).toBe('ausgeschrieben');
    expect(fake.enrolments.some((e) => e.userid !== ux)).toBe(false);
  });
});

describe('Webhooks', () => {
  it('signiert und prueft (Zeitfenster, Manipulation)', () => {
    const body = '{"a":1}'; const ts = 1_800_000_000;
    const sig = signiere('geheim', ts, body);
    expect(pruefeSignatur('geheim', sig, ts, body, { jetzt: ts + 10 })).toBe(true);
    expect(pruefeSignatur('geheim', sig, ts, '{"a":2}', { jetzt: ts })).toBe(false);
    expect(pruefeSignatur('anders', sig, ts, body, { jetzt: ts })).toBe(false);
    expect(pruefeSignatur('geheim', sig, ts, body, { jetzt: ts + 301 })).toBe(false);
  });
  it('verteilt Ereignisse auf passende Abos und stellt signiert zu', async () => {
    await pool.query(`insert into webhook_abo(name,url,secret,ereignisse) values ('Homepage','https://www.example.test/hook','s3cret',$1),('Alle','https://b.test/h','x','{*}'),('Andere','https://c.test/h','y','{rechnung.bezahlt}')`, [['anmeldung.bestaetigt']]);
    const empfangen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const f = (async (url: string, init: RequestInit) => { empfangen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response('ok', { status: url.includes('b.test') ? 500 : 200 }); }) as unknown as typeof fetch;
    const h = standardHandler(pool, { moodle: null, mail: new ProtokollMailAdapter(), fetch: f, ereignisMails: {}, pruefeWebhookZiel: async () => {} });
    await publiziere(pool, 'anmeldung.bestaetigt', { anmeldungId: '00000000-0000-0000-0000-000000000001' });
    await verarbeiteOutbox(pool, h);           // Verteilung
    const r = await verarbeiteOutbox(pool, h); // Zustellungen
    expect(r).toEqual({ erledigt: 1, fehler: 1 });
    expect(empfangen.map((e) => e.url).sort()).toEqual(['https://b.test/h', 'https://www.example.test/hook']);
    const hp = empfangen.find((e) => e.url.includes('example'))!;
    expect(hp.headers['x-bbz-ereignis']).toBe('anmeldung.bestaetigt');
    expect(pruefeSignatur('s3cret', hp.headers['x-bbz-signature'], hp.headers['x-bbz-timestamp'], hp.body)).toBe(true);
    expect((await listOutbox(pool, { typ: 'webhook.zustellung', status: 'fehler' }))[0].letzterFehler).toMatch(/HTTP 500/);
  });
});

describe('Mail', () => {
  it('Graph-Adapter holt Token (gecacht) und sendet an /users/{absender}/sendMail', async () => {
    const calls: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.includes('/oauth2/')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      expect((init.headers as any).authorization).toBe('Bearer tok');
      expect(JSON.parse(String(init.body)).message.toRecipients[0].emailAddress.address).toBe('x@bank.test');
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const g = new GraphMailAdapter({ tenantId: 't', clientId: 'c', clientSecret: 's', absender: 'info@bbz.test', fetch: f });
    await g.sende({ an: 'x@bank.test', betreff: 'B', text: 'T' });
    await g.sende({ an: 'x@bank.test', betreff: 'B', text: 'T' });
    expect(calls.filter((c) => c.includes('oauth2'))).toHaveLength(1);
    expect(calls[1]).toBe('https://graph.microsoft.com/v1.0/users/info%40bbz.test/sendMail');
  });
  it('rendert Anmeldebestaetigung aus der DB (Anrede, Termine, AGB-Hinweis)', async () => {
    const { anmeldungId } = await anmeldung({ email: 'erika@bank.test' });
    const m = await rendereMail(pool, 'anmeldebestaetigung', { anmeldungId });
    expect(m.an).toBe('erika@bank.test');
    expect(m.text).toContain('Sehr geehrte Frau Beispiel');
    expect(m.text).toContain('10.11.2026, 08:30–17:00, Zürich');
    expect(m.text).toContain('30 Tage');
  });
  it('Fachereignis loest Mail aus; Versand ueber Outbox mit Fehler bei fehlender E-Mail', async () => {
    const mail = new ProtokollMailAdapter();
    const h = standardHandler(pool, { moodle: null, mail, fetch: (async () => new Response('ok')) as unknown as typeof fetch });
    const mit = await anmeldung({ email: 'mit@bank.test' });
    const ohne = await anmeldung({ email: null });
    await publiziere(pool, 'anmeldung.bestaetigt', { anmeldungId: mit.anmeldungId });
    await publiziere(pool, 'anmeldung.bestaetigt', { anmeldungId: ohne.anmeldungId });
    await verarbeiteOutbox(pool, h); await verarbeiteOutbox(pool, h);
    expect(mail.gesendet.map((m) => m.an)).toEqual(['mit@bank.test']);
    expect((await listOutbox(pool, { typ: 'mail', status: 'fehler' }))[0].letzterFehler).toMatch(/ohne Empfaenger/);
  });
});

describe('Worker', () => {
  it('markiert unbekannte Typen als Fehler und ruft Moodle-Handler mit Konfiguration', async () => {
    const { anmeldungId } = await anmeldung();
    await enqueue(pool, 'moodle.einschreiben', anmeldungId, { anmeldungId });
    await pool.query(`insert into outbox(typ) values ('gibt.es.nicht')`);
    const r = await verarbeiteOutbox(pool, standardHandler(pool, { moodle, mail: new ProtokollMailAdapter() }));
    expect(r.erledigt).toBeGreaterThanOrEqual(1);
    expect((await listOutbox(pool, { typ: 'gibt.es.nicht' }))[0].letzterFehler).toMatch(/Kein Handler/);
    expect(fake.enrolments).toHaveLength(1);
  });
});
