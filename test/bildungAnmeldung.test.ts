import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { bildungsbestand, angebot, ausgeschrieben } from './bildungFixtures';
import {
  meldeAn, bestaetigeAnmeldung, storniereAnmeldung, setzeTeilnahme, markiereAbgeschlossen, getAnmeldung,
  listAnmeldungen, updateAnmeldung, teilnehmerliste,
} from '../src/repos/anmeldungRepo';
import { createDurchfuehrung, getDurchfuehrung, updateDurchfuehrung, setDurchfuehrungStatus } from '../src/repos/durchfuehrungRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { listLernnachweise } from '../src/repos/lernnachweisRepo';
import { listOutbox } from '../src/repos/outboxRepo';
import { listAudit } from '../src/repos/auditRepo';
import { inTransaktion } from '../src/repos/db';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof bildungsbestand>>;
beforeAll(async () => { await resetDb(pool); base = await bildungsbestand(pool); });
afterAll(async () => { await closePool(); });

let nr = 0;
const person = (vorname = 'Test') => {
  nr += 1;
  return { email: `person${nr}@bank.test`, vorname, nachname: `Person${String(nr).padStart(3, '0')}` };
};
const outboxFuer = async (typ: 'webhook' | 'moodle.einschreiben' | 'moodle.ausschreiben') => listOutbox(pool, { typ, limit: 1000 });

describe('meldeAn', () => {
  it('legt Kontakt an, uebernimmt Preis-Snapshot und publiziert anmeldung.eingegangen ohne Personendaten', async () => {
    const a = await angebot(pool, { preisChf: 1450, oeffentlich: true });
    const d = await ausgeschrieben(pool, a.id);
    const p = person('Anna');
    const res = await meldeAn(pool, d.id, { kontakt: { ...p, anrede: 'Frau', telefon: '+41 71 000 00 00' }, quelle: 'homepage' }, { heute: '2026-10-28' });
    expect(res.kontaktNeu).toBe(true);
    expect(res.warteliste).toBe(false);
    expect(res.anmeldung).toMatchObject({ status: 'angemeldet', quelle: 'homepage', preisChf: 1450, moodleStatus: 'nicht_relevant', wartelistenPosition: null });
    const [hook] = await outboxFuer('webhook');
    expect(hook.payload.ereignis).toBe('anmeldung.eingegangen');
    expect(Object.keys(hook.payload.daten).sort()).toEqual(['anmeldungId', 'durchfuehrungId', 'quelle', 'status']);
    expect(JSON.stringify(hook.payload)).not.toContain(p.email);

    // gleiche E-Mail (andere Schreibweise) -> bestehender Kontakt, aber Doppelanmeldung 409
    await expect(meldeAn(pool, d.id, { kontakt: { email: p.email.toUpperCase(), nachname: 'X' } })).rejects.toBeInstanceOf(ConflictError);
    const d2 = await ausgeschrieben(pool, a.id, { preisChf: 990 });
    const res2 = await meldeAn(pool, d2.id, { kontakt: { email: p.email.toUpperCase(), nachname: 'X' } });
    expect(res2.kontaktNeu).toBe(false);
    expect(res2.anmeldung.kontaktId).toBe(res.anmeldung.kontaktId);
    expect(res2.anmeldung.preisChf).toBe(990);                   // Override der Durchfuehrung
    expect(res2.anmeldung.quelle).toBe('manuell');
  });
  it('akzeptiert kontaktId und validiert die Eingabe', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id);
    const k = await createKontakt(pool, { nachname: 'Bestehend', email: 'bestehend@bank.test' });
    expect((await meldeAn(pool, d.id, { kontaktId: k.id })).anmeldung.kontaktId).toBe(k.id);
    await expect(meldeAn(pool, d.id, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(meldeAn(pool, d.id, { kontakt: { nachname: 'Ohne' } as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(meldeAn(pool, d.id, { kontakt: { email: 'neu-ohne-name@bank.test' } as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(meldeAn(pool, d.id, { kontakt: person(), quelle: 'fax' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(meldeAn(pool, d.id, { kontaktId: '00000000-0000-0000-0000-000000000000' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(meldeAn(pool, '00000000-0000-0000-0000-000000000000', { kontakt: person() })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('prueft Status und Anmeldeschluss', async () => {
    const a = await angebot(pool, { oeffentlich: true });
    const geplant = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-12-01', endDatum: '2026-12-01' });
    await expect(meldeAn(pool, geplant.id, { kontakt: person(), quelle: 'homepage' })).rejects.toBeInstanceOf(ConflictError);
    expect((await meldeAn(pool, geplant.id, { kontakt: person() })).anmeldung.status).toBe('angemeldet');   // manuell erlaubt

    const d = await ausgeschrieben(pool, a.id, { anmeldeschluss: '2026-11-15' });
    await expect(meldeAn(pool, d.id, { kontakt: person(), quelle: 'homepage' }, { heute: '2026-11-16' })).rejects.toBeInstanceOf(ConflictError);
    expect((await meldeAn(pool, d.id, { kontakt: person(), quelle: 'homepage' }, { heute: '2026-11-15' })).anmeldung.status).toBe('angemeldet');
    expect((await meldeAn(pool, d.id, { kontakt: person(), quelle: 'manuell' }, { heute: '2026-11-20' })).anmeldung.status).toBe('angemeldet');
    // ohne Anmeldeschluss gilt fuer die Homepage der Kursbeginn
    const ohne = await ausgeschrieben(pool, a.id);
    await expect(meldeAn(pool, ohne.id, { kontakt: person(), quelle: 'homepage' }, { heute: '2026-12-02' })).rejects.toBeInstanceOf(ConflictError);

    const abgesagt = await ausgeschrieben(pool, a.id);
    await setDurchfuehrungStatus(pool, abgesagt.id, 'abgesagt');
    await expect(meldeAn(pool, abgesagt.id, { kontakt: person() })).rejects.toBeInstanceOf(ConflictError);
  });
  it('Homepage nur fuer oeffentliche Durchfuehrungen eines oeffentlichen, aktiven Angebots', async () => {
    const intern = await angebot(pool, { oeffentlich: false });
    const d = await ausgeschrieben(pool, intern.id);
    await expect(meldeAn(pool, d.id, { kontakt: person(), quelle: 'homepage' }, { heute: '2026-10-28' })).rejects.toBeInstanceOf(NotFoundError);
    const pub = await angebot(pool, { oeffentlich: true });
    const firmenkurs = await ausgeschrieben(pool, pub.id, { oeffentlich: false, auftraggeberId: base.auftraggeber.id });
    await expect(meldeAn(pool, firmenkurs.id, { kontakt: person(), quelle: 'homepage' }, { heute: '2026-10-28' })).rejects.toBeInstanceOf(NotFoundError);
    // Firmenkurs: Rechnungsempfaenger = bestellende Bank
    expect((await meldeAn(pool, firmenkurs.id, { kontakt: person() })).anmeldung.rechnungsempfaengerId).toBe(base.auftraggeber.id);
  });
  it('Rechnungsempfaenger: explizit, sonst Debitor der Organisation des Kontakts', async () => {
    const org = await pool.query(`insert into organisation(name) values ('Urner KB') returning id`);
    await pool.query('update auftraggeber set organisation_id=$1 where id=$2', [org.rows[0].id, base.auftraggeber.id]);
    const d = await ausgeschrieben(pool, (await angebot(pool)).id);
    const mitOrg = await meldeAn(pool, d.id, { kontakt: { ...person(), organisationId: org.rows[0].id } });
    expect(mitOrg.anmeldung.rechnungsempfaengerId).toBe(base.auftraggeber.id);
    const ohne = await meldeAn(pool, d.id, { kontakt: person(), rechnungsreferenz: 'KST 4711', bemerkung: 'vegetarisch' });
    expect(ohne.anmeldung).toMatchObject({ rechnungsempfaengerId: null, rechnungsreferenz: 'KST 4711', bemerkung: 'vegetarisch' });
  });
  it('volle Durchfuehrung -> Warteliste mit Position', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { kapazitaet: 1 });
    expect((await meldeAn(pool, d.id, { kontakt: person() })).warteliste).toBe(false);
    const w1 = await meldeAn(pool, d.id, { kontakt: person() });
    const w2 = await meldeAn(pool, d.id, { kontakt: person() });
    expect(w1).toMatchObject({ warteliste: true, anmeldung: { status: 'warteliste', wartelistenPosition: 1 } });
    expect(w2.anmeldung.wartelistenPosition).toBe(2);
    expect((await getDurchfuehrung(pool, d.id)).belegung).toEqual({ kapazitaet: 1, aktiv: 1, warteliste: 2, frei: 0 });
  });
  it('Moodle-relevant, wenn die Durchfuehrung einen Moodle-Kurs hat', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { moodleKursId: 4711 });
    expect((await meldeAn(pool, d.id, { kontakt: person() })).anmeldung.moodleStatus).toBe('ausstehend');
  });
  it('Idempotenz-Schluessel liefert die bestehende Anmeldung (auch parallel)', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool, { oeffentlich: true })).id);
    const p = person();
    const vorher = (await outboxFuer('webhook')).length;
    const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() =>
      meldeAn(pool, d.id, { kontakt: p, quelle: 'homepage', idempotenzSchluessel: 'idem-1' }, { heute: '2026-10-28' })));
    expect(new Set([r1.anmeldung.id, r2.anmeldung.id, r3.anmeldung.id]).size).toBe(1);
    expect((await outboxFuer('webhook')).length).toBe(vorher + 1);
    const nochmal = await meldeAn(pool, d.id, { kontakt: p, idempotenzSchluessel: 'idem-1' });
    expect(nochmal.anmeldung.id).toBe(r1.anmeldung.id);
    const anders = await ausgeschrieben(pool, (await angebot(pool)).id);
    await expect(meldeAn(pool, anders.id, { kontakt: p, idempotenzSchluessel: 'idem-1' })).rejects.toBeInstanceOf(ConflictError);
  });
  it('parallele Anmeldungen ueberbuchen nie (Zeilensperre)', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool, { oeffentlich: true })).id, { kapazitaet: 2 });
    const res = await Promise.all(Array.from({ length: 8 }, () => meldeAn(pool, d.id, { kontakt: person(), quelle: 'homepage' }, { heute: '2026-10-28' })));
    expect(res.filter((r) => !r.warteliste)).toHaveLength(2);
    const liste = await listAnmeldungen(pool, { durchfuehrungId: d.id, status: 'warteliste' });
    expect(liste.map((x) => x.wartelistenPosition).sort((x, y) => x! - y!)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await getDurchfuehrung(pool, d.id)).belegung).toEqual({ kapazitaet: 2, aktiv: 2, warteliste: 6, frei: 0 });
  });
});

describe('bestaetigen', () => {
  it('angemeldet -> bestaetigt; mit Moodle-Kurs Outbox moodle.einschreiben', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { moodleKursId: 99, kapazitaet: 1 });
    const { anmeldung } = await meldeAn(pool, d.id, { kontakt: person() });
    const b = await bestaetigeAnmeldung(pool, anmeldung.id, 'ml');
    expect(b.status).toBe('bestaetigt');
    expect(b.bestaetigtAm).not.toBeNull();
    const ein = (await outboxFuer('moodle.einschreiben')).filter((o) => o.aggregatId === anmeldung.id);
    expect(ein).toHaveLength(1);
    expect(ein[0].payload).toEqual({ anmeldungId: anmeldung.id });
    expect((await outboxFuer('webhook'))[0].payload).toMatchObject({ ereignis: 'anmeldung.bestaetigt', daten: { anmeldungId: anmeldung.id } });
    await expect(bestaetigeAnmeldung(pool, anmeldung.id)).rejects.toBeInstanceOf(ConflictError);
    const w = await meldeAn(pool, d.id, { kontakt: person() });
    await expect(bestaetigeAnmeldung(pool, w.anmeldung.id)).rejects.toBeInstanceOf(ConflictError);
  });
  it('ohne Moodle-Kurs keine Einschreibung; Moodle-Kurs nachtraeglich -> bestaetigte werden eingeschrieben', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id);
    const { anmeldung } = await meldeAn(pool, d.id, { kontakt: person() });
    await bestaetigeAnmeldung(pool, anmeldung.id);
    expect((await outboxFuer('moodle.einschreiben')).some((o) => o.aggregatId === anmeldung.id)).toBe(false);
    await updateDurchfuehrung(pool, d.id, { moodleKursId: 123 });
    expect((await getAnmeldung(pool, anmeldung.id)).moodleStatus).toBe('ausstehend');
    expect((await outboxFuer('moodle.einschreiben')).some((o) => o.aggregatId === anmeldung.id)).toBe(true);
  });
});

describe('stornieren', () => {
  it('Annullationskosten nach AGB (mehr als 30 Tage 0 %, sonst 100 %), Audit', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool, { preisChf: 1200 })).id);   // Beginn 2026-12-01
    const a1 = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    const a2 = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    const a3 = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    const s1 = await storniereAnmeldung(pool, a1.id, { grund: 'Terminkollision', datum: '2026-10-31' }, 'ml');
    expect(s1.anmeldung).toMatchObject({ status: 'storniert', stornogrund: 'Terminkollision', stornogebuehrChf: 0 });
    expect(s1.anmeldung.storniertAm).not.toBeNull();
    expect((await storniereAnmeldung(pool, a2.id, { grund: 'Krankheit', datum: '2026-11-01' })).anmeldung.stornogebuehrChf).toBe(1200);
    // Kulanz: Gebuehr manuell ueberschreiben
    expect((await storniereAnmeldung(pool, a3.id, { grund: 'Kulanz', datum: '2026-11-20', stornogebuehrChf: 300 })).anmeldung.stornogebuehrChf).toBe(300);
    await expect(storniereAnmeldung(pool, a1.id, { grund: 'nochmals' })).rejects.toBeInstanceOf(ConflictError);
    expect((await listAudit(pool, 'anmeldung', a1.id))[0]).toMatchObject({ benutzer: 'ml', aktion: 'storno' });
    const a4 = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    await expect(storniereAnmeldung(pool, a4.id, { grund: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(storniereAnmeldung(pool, a4.id, { grund: 'x', datum: '1.11.2026' })).rejects.toBeInstanceOf(ValidationError);
  });
  it('Warteliste rueckt nach und wird neu nummeriert', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { kapazitaet: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await meldeAn(pool, d.id, { kontakt: person() })).anmeldung.id);
    const res = await storniereAnmeldung(pool, ids[0], { grund: 'Krankheit', datum: '2026-10-01' });
    expect(res.nachgerueckt.map((x) => x.id)).toEqual([ids[2]]);
    expect(res.nachgerueckt[0]).toMatchObject({ status: 'angemeldet', wartelistenPosition: null });
    expect((await getAnmeldung(pool, ids[3])).wartelistenPosition).toBe(1);
    expect((await getAnmeldung(pool, ids[4])).wartelistenPosition).toBe(2);
    const hooks = (await outboxFuer('webhook')).map((o) => o.payload.ereignis);
    expect(hooks.slice(0, 2).sort()).toEqual(['anmeldung.nachgerueckt', 'anmeldung.storniert']);
    // Storno von der Warteliste: gebuehrenfrei, kein Nachruecken, Rest neu nummeriert
    const w = await storniereAnmeldung(pool, ids[3], { grund: 'kein Bedarf', datum: '2026-11-30' });
    expect(w.anmeldung.stornogebuehrChf).toBe(0);
    expect(w.nachgerueckt).toEqual([]);
    expect((await getAnmeldung(pool, ids[4])).wartelistenPosition).toBe(1);
    expect((await getDurchfuehrung(pool, d.id)).belegung).toEqual({ kapazitaet: 2, aktiv: 2, warteliste: 1, frei: 0 });
  });
  it('mehr Kapazitaet laesst die Warteliste nachruecken', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { kapazitaet: 1 });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await meldeAn(pool, d.id, { kontakt: person() })).anmeldung.id);
    const u = await updateDurchfuehrung(pool, d.id, { kapazitaet: 3 });
    expect(u.belegung).toEqual({ kapazitaet: 3, aktiv: 3, warteliste: 1, frei: 0 });
    expect((await getAnmeldung(pool, ids[3])).wartelistenPosition).toBe(1);
  });
  it('eingeschriebene Anmeldung -> Outbox moodle.ausschreiben', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { moodleKursId: 77 });
    const { anmeldung } = await meldeAn(pool, d.id, { kontakt: person() });
    await bestaetigeAnmeldung(pool, anmeldung.id);
    await pool.query(`update anmeldung set moodle_status='eingeschrieben' where id=$1`, [anmeldung.id]);   // Worker simuliert
    await storniereAnmeldung(pool, anmeldung.id, { grund: 'Stellenwechsel', datum: '2026-10-01' });
    expect((await outboxFuer('moodle.ausschreiben')).filter((o) => o.aggregatId === anmeldung.id)).toHaveLength(1);
  });
  it('Ersatzperson uebernimmt den Platz kostenlos (AGB)', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool, { preisChf: 800 })).id, { kapazitaet: 1, moodleKursId: 55 });
    const orig = (await meldeAn(pool, d.id, { kontakt: person(), rechnungsempfaengerId: base.auftraggeber.id, rechnungsreferenz: 'R-1' })).anmeldung;
    await bestaetigeAnmeldung(pool, orig.id);
    const wartend = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    const ersatz = person('Ersatz');
    const res = await storniereAnmeldung(pool, orig.id, { grund: 'Ersatzperson', datum: '2026-11-25', ersatzKontakt: { kontakt: ersatz } });
    expect(res.anmeldung).toMatchObject({ status: 'storniert', stornogebuehrChf: 0 });
    expect(res.nachgerueckt).toEqual([]);
    expect(res.ersatz).toMatchObject({ status: 'bestaetigt', preisChf: 800, rechnungsempfaengerId: base.auftraggeber.id, rechnungsreferenz: 'R-1', moodleStatus: 'ausstehend' });
    expect((await outboxFuer('moodle.einschreiben')).some((o) => o.aggregatId === res.ersatz!.id)).toBe(true);
    expect((await getAnmeldung(pool, wartend.id)).wartelistenPosition).toBe(1);
    // bereits angemeldete Person kann nicht Ersatz sein
    await expect(storniereAnmeldung(pool, res.ersatz!.id, { grund: 'x', ersatzKontakt: { kontaktId: wartend.kontaktId } }))
      .rejects.toBeInstanceOf(ConflictError);
    // Ersatz nur fuer Personen mit Platz
    await expect(storniereAnmeldung(pool, wartend.id, { grund: 'x', ersatzKontakt: { kontakt: person() } }))
      .rejects.toBeInstanceOf(ConflictError);
  });
  it('Absage der Durchfuehrung storniert alle gebuehrenfrei inkl. Outbox', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { kapazitaet: 1, moodleKursId: 66 });
    const a = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    await bestaetigeAnmeldung(pool, a.id);
    await pool.query(`update anmeldung set moodle_status='eingeschrieben' where id=$1`, [a.id]);
    const w = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    const vorher = (await outboxFuer('webhook')).length;
    await setDurchfuehrungStatus(pool, d.id, 'abgesagt', 'ml');
    for (const id of [a.id, w.id]) {
      expect(await getAnmeldung(pool, id)).toMatchObject({ status: 'storniert', stornogrund: 'Durchfuehrung abgesagt', stornogebuehrChf: 0, wartelistenPosition: null });
    }
    expect((await outboxFuer('moodle.ausschreiben')).filter((o) => o.aggregatId === a.id)).toHaveLength(1);
    expect((await outboxFuer('moodle.ausschreiben')).some((o) => o.aggregatId === w.id)).toBe(false);
    const neu = (await outboxFuer('webhook')).slice(0, (await outboxFuer('webhook')).length - vorher).map((o) => o.payload.ereignis);
    expect(neu.sort()).toEqual(['anmeldung.storniert', 'anmeldung.storniert', 'kurs.aktualisiert']);
  });
});

describe('teilnahme und Abschluss', () => {
  it('teilgenommen -> abgeschlossen erzeugt genau einen Lernnachweis', async () => {
    const a = await angebot(pool, { titel: 'Anlageberatung kompakt', lernstunden: 7.5 });
    const d = await ausgeschrieben(pool, a.id);
    const an = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    await bestaetigeAnmeldung(pool, an.id);
    expect((await setzeTeilnahme(pool, an.id, 'teilgenommen')).status).toBe('teilgenommen');
    const ab = await setzeTeilnahme(pool, an.id, 'abgeschlossen', 'ml');
    expect(ab.status).toBe('abgeschlossen');
    expect(ab.abgeschlossenAm).not.toBeNull();
    expect(await setzeTeilnahme(pool, an.id, 'abgeschlossen')).toMatchObject({ status: 'abgeschlossen' });   // idempotent
    const ln = await listLernnachweise(pool, an.kontaktId);
    expect(ln).toHaveLength(1);
    expect(ln[0]).toMatchObject({ anmeldungId: an.id, lernstunden: 7.5, quelle: 'kurs', titel: `Anlageberatung kompakt (${d.code})` });
    await expect(setzeTeilnahme(pool, an.id, 'nicht_bestanden')).rejects.toBeInstanceOf(ConflictError);
    await expect(setzeTeilnahme(pool, an.id, 'storniert' as any)).rejects.toBeInstanceOf(ValidationError);
  });
  it('Warteliste/Storno koennen nicht teilnehmen', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { kapazitaet: 1 });
    await meldeAn(pool, d.id, { kontakt: person() });
    const w = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    await expect(setzeTeilnahme(pool, w.id, 'teilgenommen')).rejects.toBeInstanceOf(ConflictError);
  });
  it('markiereAbgeschlossen (Moodle-Sync) ist idempotent und laeuft in fremder Transaktion', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool, { lernstunden: 4 })).id);
    const an = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    await bestaetigeAnmeldung(pool, an.id);
    const r1 = await inTransaktion(pool, (c) => markiereAbgeschlossen(c, an.id, '2026-12-01T22:30:00Z', 'moodle'));
    expect(r1.geaendert).toBe(true);
    expect(r1.anmeldung.status).toBe('abgeschlossen');
    expect(r1.lernnachweis).toMatchObject({ datum: '2026-12-01', lernstunden: 4, quelle: 'moodle' });   // 23:30 Zuerich
    const r2 = await markiereAbgeschlossen(pool, an.id, new Date(), 'moodle');
    expect(r2.geaendert).toBe(false);
    expect(r2.lernnachweis.id).toBe(r1.lernnachweis.id);
    expect(r2.anmeldung.abgeschlossenAm).toBe(r1.anmeldung.abgeschlossenAm);
    expect(await listLernnachweise(pool, an.kontaktId)).toHaveLength(1);
    await expect(markiereAbgeschlossen(pool, an.id, 'kein Datum', 'manuell')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('Listen', () => {
  it('Filter, Teilnehmerliste ohne Stornos, Warteliste am Ende', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { kapazitaet: 2 });
    const b = (await meldeAn(pool, d.id, { kontakt: { email: 'b@x.test', vorname: 'Bea', nachname: 'Zuber' } })).anmeldung;
    await meldeAn(pool, d.id, { kontakt: { email: 'a@x.test', vorname: 'Adi', nachname: 'Amrein' } });
    const w = (await meldeAn(pool, d.id, { kontakt: { email: 'c@x.test', vorname: 'Cem', nachname: 'Aebi' } })).anmeldung;
    const s = (await meldeAn(pool, d.id, { kontakt: { email: 'd@x.test', vorname: 'Dan', nachname: 'Berger' } })).anmeldung;
    await storniereAnmeldung(pool, s.id, { grund: 'x', datum: '2026-10-01' });
    expect(await listAnmeldungen(pool, { durchfuehrungId: d.id })).toHaveLength(4);
    expect((await listAnmeldungen(pool, { kontaktId: b.kontaktId })).map((x) => x.id)).toEqual([b.id]);
    const tl = await teilnehmerliste(pool, d.id);
    expect(tl.map((t) => `${t.nachname}:${t.status}`)).toEqual(['Amrein:angemeldet', 'Zuber:angemeldet', 'Aebi:warteliste']);
    expect(tl[2]).toMatchObject({ anmeldungId: w.id, email: 'c@x.test', wartelistenPosition: 1 });
  });
  it('updateAnmeldung setzt Rechnungsempfaenger/Referenz', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id);
    const a = (await meldeAn(pool, d.id, { kontakt: person() })).anmeldung;
    const u = await updateAnmeldung(pool, a.id, { rechnungsempfaengerId: base.auftraggeber.id, rechnungsreferenz: 'PO-9' });
    expect(u).toMatchObject({ rechnungsempfaengerId: base.auftraggeber.id, rechnungsreferenz: 'PO-9' });
    await expect(updateAnmeldung(pool, '00000000-0000-0000-0000-000000000000', { bemerkung: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
