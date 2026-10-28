import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { buildApp } from '../src/server/app';
import { bildungsbestand, angebot, ausgeschrieben } from './bildungFixtures';
import { createOrganisation } from '../src/repos/organisationRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { listAnmeldungen } from '../src/repos/anmeldungRepo';
import { getKontakt } from '../src/repos/kontaktRepo';
import { getDurchfuehrung } from '../src/repos/durchfuehrungRepo';
import { liesBuchungenCsv, importiereKursdatenBericht } from '../src/integrations/moodle/buchungen';

/*
 * Moodle-Bericht "Anmeldungen Kursdaten V2" (Berichtsgenerator, CSV-Export) ueber alle Face-to-Face-Termine.
 * Zuordnung zur Durchfuehrung ueber das Terminfeld "Seminarnummer" (docs/integration/MOODLE.md §5).
 */
const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin' };

const KOPF = 'Nachname,Vorname,E-Mail-Adresse,Funktion,Telefonnummer,Geschäftsadresse,Rechnungsadresse (falls abweichend von Geschäftsadresse),'
  + 'Seminarnummer,Vollständiger Kursname,Datum des Veranstaltungsbeginns,Booked / Capacity,Erstellungsdatum,Session status,Profil,Bank';
const BERICHT = [
  KOPF,
  'Amrein,Anna,anna@bank.test,Kundenberaterin,071 000 00 01,"Marktgasse 1, 9000 St. Gallen",,8961,Kurs A,24.11.2026,2 / 12,01.10.2026,Ausgebucht,Privatkunden,Testbank Kursdaten AG',
  'Zuber,Beat,beat@bank.test,Teamleiter,,"Bahnhofstr. 2, 6000 Luzern","Postfach 9, 6000 Luzern",8961,Kurs A,24.11.2026,2 / 12,02.10.2026,Ausgebucht,KMU,Andere',
  'Aebi,Cem,cem@bank.test,,,,,9045,Kurs B,30.11.2027,1 / 15,03.10.2026,Buchung möglich,Affluent,',
  'Muster,Dora,dora@bank.test,,,,,1234,Kurs C,01.12.2027,1 / 10,04.10.2026,Buchung möglich,,',
].join('\n');

let d1: string; let d2: string; let empfaenger: string;
beforeAll(async () => {
  await resetDb(pool);
  const base = await bildungsbestand(pool);
  const org = await createOrganisation(pool, { name: 'Testbank Kursdaten AG' });
  empfaenger = (await createAuftraggeber(pool, { nummer: '30001', name: 'Testbank Kursdaten AG', strasse: 'S 1', plz: '9000', ort: 'St. Gallen' })).id;
  await pool.query('update auftraggeber set organisation_id=$2 where id=$1', [empfaenger, org.id]);
  const ka = await angebot(pool);
  d1 = (await ausgeschrieben(pool, ka.id, { seminarnummer: '8961', projektId: base.projekt.id, kapazitaet: 12 })).id;
  d2 = (await ausgeschrieben(pool, ka.id, { seminarnummer: '9045', projektId: base.projekt.id, kapazitaet: 15 })).id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('Moodle-Bericht "Anmeldungen Kursdaten V2"', () => {
  it('liest die Spalten des Berichtsgenerators (Komma, Umlaute, Rechnungsadresse, Bank)', () => {
    const z = liesBuchungenCsv(BERICHT);
    expect(z[1]).toMatchObject({
      email: 'beat@bank.test', vorname: 'Beat', nachname: 'Zuber', funktion: 'Teamleiter', seminarnummer: '8961',
      rechnungsadresse: 'Postfach 9, 6000 Luzern', bank: 'Andere',
    });
    expect(z[0].telefon).toBe('071 000 00 01');
  });

  it('die Durchfuehrung fuehrt die Seminarnummer', async () => {
    expect((await getDurchfuehrung(pool, d1)).seminarnummer).toBe('8961');
  });

  it('ordnet ueber die Seminarnummer zu, bestaetigt die Buchungen und meldet unbekannte Seminarnummern', async () => {
    const r = await importiereKursdatenBericht(pool, BERICHT, 'ml');
    expect(r.seminare.map((s) => [s.seminarnummer, s.durchfuehrungId, s.neu, s.bestaetigt])).toEqual([['8961', d1, 2, 2], ['9045', d2, 1, 1]]);
    expect(r.unbekannteSeminarnummern).toEqual(['1234']);
    const liste = await listAnmeldungen(pool, { durchfuehrungId: d1 });
    expect(liste.map((a) => a.status)).toEqual(['bestaetigt', 'bestaetigt']);
  });

  it('setzt den Rechnungsempfaenger ueber die Bank und haelt eine abweichende Rechnungsadresse fest', async () => {
    const liste = await listAnmeldungen(pool, { durchfuehrungId: d1 });
    const anna = liste.find((a) => a.kontaktName === 'Anna Amrein')!;
    const beat = liste.find((a) => a.kontaktName === 'Beat Zuber')!;
    expect(anna.rechnungsempfaengerId).toBe(empfaenger);
    expect((await getKontakt(pool, anna.kontaktId)).funktion).toBe('Kundenberaterin');
    expect(beat.rechnungsempfaengerId).toBeNull();
    expect(beat.bemerkung).toContain('Rechnungsadresse laut Moodle: Postfach 9, 6000 Luzern');
  });

  it('ist idempotent', async () => {
    const r = await importiereKursdatenBericht(pool, BERICHT, 'ml');
    expect(r.seminare.map((s) => [s.neu, s.bereitsVorhanden])).toEqual([[0, 2], [0, 1]]);
  });

  it('Route POST /integration/moodle/kursdaten nur fuer Admin', async () => {
    expect((await app.inject({ method: 'POST', url: '/integration/moodle/kursdaten', payload: { csv: BERICHT } })).statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/integration/moodle/kursdaten', headers: admin, payload: { csv: BERICHT } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().unbekannteSeminarnummern).toEqual(['1234']);
    expect((await app.inject({ method: 'POST', url: '/integration/moodle/kursdaten', headers: admin, payload: { csv: '' } })).statusCode).toBe(400);
  });
});
