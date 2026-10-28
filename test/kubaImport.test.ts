import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createOrganisation } from '../src/repos/organisationRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { createReferent } from '../src/repos/referentRepo';
import { createSaqFall, getSaqFall, kubaExport } from '../src/repos/saqRepo';
import { importiere, berichtMarkdown, type KubaBericht } from '../tools/kuba-import/import';
import { KubaStrukturFehler } from '../tools/kuba-import/kuba';
import { standardDatei, baueKubaXlsx, HEUTE } from './kubaFixture';

const pool = getPool();
const ids = { bekb: '', raiffeisen: '', clara: '', annaCrm: '', zeno: '' };
const anzahl = async (sql: string, args: unknown[] = []) => (await pool.query(`select count(*)::int as n from ${sql}`, args)).rows[0].n as number;
const fall = async (nachname: string, profil: string) => {
  const r = await pool.query(
    `select f.*, k.nachname, k.vorname, k.geburtsdatum from saq_fall f join kontakt k on k.id=f.kontakt_id where k.nachname=$1 and f.profil=$2 order by f.erstellt_am, f.kuba_herkunft`,
    [nachname, profil]);
  expect(r.rowCount, `${nachname}/${profil}`).toBe(1);
  return r.rows[0];
};
const runs = async (fallId: string) => (await pool.query(
  `select art, teil, run, datum, bestanden, resultat_prozent, score, ort, remote, experte1_id, experte2_id
   from saq_pruefung where fall_id=$1 order by (art='muendlich'), teil, run`, [fallId])).rows;

beforeAll(async () => {
  await resetDb(pool);
  ids.bekb = (await createOrganisation(pool, { name: 'Berner Kantonalbank AG', branche: 'Kantonalbank' })).id;
  ids.raiffeisen = (await createOrganisation(pool, { name: 'Raiffeisen' })).id;
  // bestehende CRM-Kontakte: Clara mit Geburtsdatum (z. B. Homepage), Anna ohne Geburtsdatum (z. B. FileMaker)
  ids.clara = (await createKontakt(pool, { nachname: 'Exempel', vorname: 'Clara', geburtsdatum: '1992-01-15', email: 'clara.exempel@beispiel.test' })).id;
  ids.annaCrm = (await createKontakt(pool, { nachname: 'Muster', vorname: 'Anna', email: 'anna.muster@beispiel.test' })).id;
  const zenoKontakt = await createKontakt(pool, { nachname: 'Zweitpruefer', vorname: 'Zeno' });
  ids.zeno = (await createReferent(pool, { typ: 'extern', kontaktId: zenoKontakt.id, anzeigename: 'Zeno Zweitpruefer' })).id;
});
afterAll(async () => { await closePool(); });

describe('kuba-import: historischer Import in die SAQ-Tabellen', () => {
  it('fehlender Pflicht-Header bricht vor jedem DB-Zugriff ab', async () => {
    const datei = baueKubaXlsx({ first: [], issued: [], ohneHeader: { first: ['Employer'] } });
    await expect(importiere(pool, datei, { probelauf: false, heute: HEUTE })).rejects.toThrow(KubaStrukturFehler);
    expect(await anzahl('integration_lauf')).toBe(0);
  });

  it('Probelauf fuehrt alles aus und speichert nichts', async () => {
    const b = await importiere(pool, standardDatei(), { probelauf: true, heute: HEUTE });
    expect(b.probelauf).toBe(true);
    expect(b.faelle).toEqual({ neu: 9, vorhanden: 0, fehler: 0 });
    expect(await anzahl('saq_fall')).toBe(0);
    expect(await anzahl('kontakt')).toBe(3);
    expect(await anzahl('referent')).toBe(1);
    expect(await anzahl('integration_lauf')).toBe(0);
  });

  let erster: KubaBericht;
  it('Import: Zaehler fuer Bericht (Zeilen, Vorgaenge, Duplikate, Personen, Organisationen, Runs, Zertifikate, Experten)', async () => {
    erster = await importiere(pool, standardDatei(), { probelauf: false, heute: HEUTE, datei: 'Reporting_KUBA.xlsx' });
    expect(erster).toMatchObject({
      probelauf: false,
      zeilen: { first: 9, issued: 3 }, ohneName: 1, vorgaenge: 10, duplikate: 1, profilKonflikte: 1,
      faelle: { neu: 9, vorhanden: 0, fehler: 0 },
      nichtImportiert: [{ herkunft: 'First Certification:17', grund: 'Profil «XYZ» unbekannt' }],
      personen: { neu: 5, gematcht: 1, ohneGeburtsdatum: 1, moeglicheDubletten: 1 },
      organisationen: {
        zugeordnet: { organisationen: 2, vorgaenge: 6 }, ohneArbeitgeber: 0,
        nichtZugeordnet: [{ name: 'Bank Unbekannt AG', kanon: null, vorgaenge: 2 }, { name: 'SGKB', kanon: 'St. Galler Kantonalbank', vorgaenge: 1 }],
      },
      runs: { neu: 15, ergaenzt: 0, vorhanden: 0 },
      zertifikate: { neu: 2, vorhanden: 0 },
      experten: { neu: 1, gematcht: 1 },
      fehler: [],
    });
    expect(erster.statusJeProfil.find((p) => p.profil === 'PK')).toEqual({
      profil: 'PK', kuba: { bestanden: 2, 'nicht bestanden': 1, offen: 1, 'nicht erfasst': 0 },
      erp: { angemeldet: 0, in_pruefung: 1, schriftlich_bestanden: 0, bestanden: 1, zertifiziert: 1, nicht_bestanden: 1, abgebrochen: 0 },
    });
    expect(erster.statusJeProfil.find((p) => p.profil === 'AFFL')?.erp).toMatchObject({ angemeldet: 1, schriftlich_bestanden: 1 });
    expect(erster.statusJeProfil.find((p) => p.profil === 'unbekannt')?.kuba).toMatchObject({ offen: 1 });
    expect(erster.dq.filter((d) => d.stufe === 'fehler').length).toBeGreaterThanOrEqual(6);
  });

  it('Vorgang -> saq_fall mit Herkunft, Bank, Sprache, Rolle, Kennzeichnung, Status und Zertifikat', async () => {
    const anna = await fall('Muster', 'PK');
    expect(anna).toMatchObject({
      kuba_herkunft: 'First Certification:11; Ausgestellte Zertifikate:11', organisation_id: ids.bekb, sprache: 'DE',
      rolle: 'Kundenberaterin', kennzeichnung: 'VSM', status: 'zertifiziert', geburtsdatum: '1990-04-12', variante: 'erstzertifizierung',
    });
    // CRM-Kontakt "Muster Anna" ohne Geburtsdatum wird nicht verwendet (moegliche Dublette, Hinweis im Log)
    expect(anna.kontakt_id).not.toBe(ids.annaCrm);
    expect(erster.dq).toContainEqual(expect.objectContaining({ sheet: 'First Certification', zeile: 11, grund: expect.stringMatching(/gleichem Namen ohne Geburtsdatum/) }));
    const z = (await pool.query('select * from zertifizierung where id=$1', [anna.zertifizierung_id])).rows[0];
    expect(z).toMatchObject({ kontakt_id: anna.kontakt_id, typ: 'SAQ Kundenberater Bank', profil: 'PK', sprache: 'DE', zertifikat_nr: 'Z-1001', ausgestellt_am: '2024-06-01', gueltig_bis: '2027-05-31' });

    const annaAffl = await fall('Muster', 'AFFL');
    expect(annaAffl).toMatchObject({ kontakt_id: anna.kontakt_id, status: 'angemeldet', kuba_herkunft: 'First Certification:20' });

    const brunoAffl = await fall('Beispiel', 'AFFL');
    const brunoCwma = await fall('Beispiel', 'CWMA');
    expect(brunoAffl.kontakt_id).toBe(brunoCwma.kontakt_id);
    expect(brunoAffl).toMatchObject({ status: 'schriftlich_bestanden', organisation_id: null, sprache: 'FR' });
    expect(brunoAffl.bemerkung).toMatch(/Arbeitgeber laut KUBA: «Bank Unbekannt AG» \(keine CRM-Organisation zugeordnet\)/);
    expect(brunoCwma.status).toBe('zertifiziert');
    expect((await pool.query('select gueltig_bis from zertifizierung where id=$1', [brunoCwma.zertifizierung_id])).rows[0].gueltig_bis).toBe('2028-09-01');

    const clara = await fall('Exempel', 'PK');
    expect(clara).toMatchObject({ kontakt_id: ids.clara, status: 'nicht_bestanden', organisation_id: ids.raiffeisen, sprache: 'FR' });
    expect((await pool.query('select organisation_id from kontakt where id=$1', [ids.clara])).rows[0].organisation_id).toBe(ids.raiffeisen);

    expect((await fall('Probe', 'CCoB')).status).toBe('in_pruefung');
    expect(await fall('Fiktiv', 'IK')).toMatchObject({ status: 'angemeldet', sprache: 'EN', geburtsdatum: null });
    const hans = (await pool.query(`select f.status, f.kuba_herkunft, f.zertifizierung_id from saq_fall f join kontakt k on k.id=f.kontakt_id where k.nachname='Konflikt' order by f.kuba_herkunft`)).rows;
    expect(hans).toEqual([
      { status: 'bestanden', kuba_herkunft: 'Ausgestellte Zertifikate:13', zertifizierung_id: null },
      { status: 'in_pruefung', kuba_herkunft: 'First Certification:19', zertifizierung_id: null },
    ]);
    expect(await anzahl('kontakt where nachname=$1', ['Konflikt'])).toBe(1);
  });

  it('Runs -> saq_pruefung (Prozent, Ort/Remote, Experten als Referent), auch wenn heutige Regeln verletzt waeren', async () => {
    const anna = await fall('Muster', 'PK');
    const erika = (await pool.query(`select r.id, r.typ, r.bemerkung, k.bemerkung as kb from referent r join kontakt k on k.id=r.kontakt_id where r.anzeigename='Erika Expertin'`)).rows;
    expect(erika).toHaveLength(1);
    expect(erika[0]).toMatchObject({ typ: 'extern', bemerkung: expect.stringMatching(/aus KUBA/), kb: expect.stringMatching(/aus KUBA/) });
    expect(await runs(anna.id)).toEqual([
      { art: 'schriftlich', teil: 1, run: 1, datum: '2024-03-04', bestanden: true, resultat_prozent: '82.00', score: '41.00', ort: 'Bern', remote: false, experte1_id: null, experte2_id: null },
      { art: 'muendlich', teil: 1, run: 1, datum: '2024-05-06', bestanden: true, resultat_prozent: '90.00', score: '18.00', ort: 'Remote', remote: true, experte1_id: erika[0].id, experte2_id: ids.zeno },
    ]);
    // Bruno AFFL: RUN2 nach nicht bestandenem RUN1, geplanter muendlicher Run ohne Arbeitgeberbestaetigung
    const bruno = await fall('Beispiel', 'AFFL');
    expect((await runs(bruno.id)).map((r: any) => [r.art, r.teil, r.run, r.bestanden, r.resultat_prozent])).toEqual([
      ['schriftlich', 1, 1, false, '55.00'], ['schriftlich', 1, 2, true, '71.50'], ['schriftlich', 2, 1, true, '80.00'], ['muendlich', 1, 1, null, null],
    ]);
    expect((await runs((await fall('Beispiel', 'CWMA')).id))[1].experte1_id).toBe(erika[0].id);
    expect(await anzahl('saq_pruefung')).toBe(15);
    // historischer Import loest keine Integrationen aus (kein saq.angemeldet in der Outbox), Revisionsspur je Fall
    expect(await anzahl('outbox')).toBe(0);
    expect(await anzahl(`audit_log where aktion='saq.kuba_import'`)).toBe(9);
    expect((await pool.query(`select typ, status, ergebnis from integration_lauf`)).rows).toEqual([
      expect.objectContaining({ typ: 'kuba.import', status: 'teilweise', ergebnis: expect.objectContaining({ faelleNeu: 9, nichtImportiert: 1 }) }),
    ]);
  });

  it('importierte Faelle sind im ERP lesbar und im KUBA-Feldschema exportierbar', async () => {
    const anna = await fall('Muster', 'PK');
    const d = await getSaqFall(pool, anna.id, HEUTE);
    expect(d).toMatchObject({ status: 'zertifiziert', schriftlichAlleBestanden: true, muendlichAlleBestanden: true, zertifizierung: { zertifikatNr: 'Z-1001' } });
    const zeile = (await kubaExport(pool)).find((z) => z.erpFallId === anna.id)!;
    expect(zeile).toMatchObject({ lastName: 'Muster', profil: 'PK', certNumber: 'Z-1001', weAllPassed: 'yes', 'we1.run1.result': 0.82, 'oe1.run1.expert1': 'Erika Expertin' });
  });

  it('Bericht als Markdown: Zaehler, nicht zugeordnete Banken, Data-Quality-Log, Status je Profil', () => {
    const md = berichtMarkdown(erster);
    expect(md).toMatch(/^# KUBA-Import \(ausgefuehrt\)/);
    expect(md).toContain('| First Certification | 9 |');
    expect(md).toContain('| Bank Unbekannt AG | 2 |');
    expect(md).toContain('| SGKB (St. Galler Kantonalbank) | 1 |');
    expect(md).toContain('| First Certification | 14 | WE1 RUN1 Passed | vielleicht | fehler |');
    expect(md).toMatch(/\| PK \| 2 \| 1 \| 1 \| 0 \|/);
    expect(md).toContain('First Certification:17');
  });

  it('ist idempotent: erneuter Lauf findet Faelle (kuba_herkunft), Personen, Runs, Zertifikate und Experten', async () => {
    const vorher = { faelle: await anzahl('saq_fall'), kontakte: await anzahl('kontakt'), runs: await anzahl('saq_pruefung'), z: await anzahl('zertifizierung'), r: await anzahl('referent') };
    const b = await importiere(pool, standardDatei(), { probelauf: false, heute: HEUTE });
    expect(b).toMatchObject({
      faelle: { neu: 0, vorhanden: 9, fehler: 0 }, personen: { neu: 0, gematcht: 6 }, runs: { neu: 0, ergaenzt: 0, vorhanden: 15 },
      zertifikate: { neu: 0, vorhanden: 2 }, experten: { neu: 0, gematcht: 2 },
    });
    expect({ faelle: await anzahl('saq_fall'), kontakte: await anzahl('kontakt'), runs: await anzahl('saq_pruefung'), z: await anzahl('zertifizierung'), r: await anzahl('referent') }).toEqual(vorher);
    expect(b.statusJeProfil).toEqual(erster.statusJeProfil);
  });

  it('aktualisierte Datei: Luecken werden ergaenzt, Status nur vorwaerts, ERP-Fall aus der Homepage wird gefunden', async () => {
    // Nora hat sich ueber die Homepage angemeldet (ERP-Fall ohne kuba_herkunft); KUBA fuehrt sie spaeter mit Ergebnis
    const nora = await createSaqFall(pool, { profil: 'IK', kontakt: { email: 'nora.neu@beispiel.test', nachname: 'Neu', vorname: 'Nora', geburtsdatum: '1995-05-05' } });
    const outboxVorher = await anzahl('outbox');
    const datei = baueKubaXlsx({
      first: [
        // Bruno: muendliche Pruefung inzwischen bestanden
        {
          'Last Name': 'Beispiel', 'First Name': 'Bruno', 'Birth Date': { datum: '1985-11-30' }, Employer: 'Bank Unbekannt AG', 'Certificate Program': 'AFFL', 'Certificate Language': 'FR',
          'WE All Passed': 'yes', 'WE1 RUN1 Passed': 'no', 'WE1 RUN1 Date': { datum: '2024-02-01' },
          'OE All Passed': 'yes', 'OE1 RUN1 Passed': 'yes', 'OE1 RUN1 Date': { datum: '2026-12-03' }, 'OE1 RUN1 Result': 0.85, 'OE1 RUN1 Expert 1': 'Erika Expertin',
        },
        // Clara: Datei widerspricht dem abgeschlossenen ERP-Fall -> nichts wird zurueckgesetzt oder ueberschrieben
        { 'Last Name': 'Exempel', 'First Name': 'Clara', 'Birth Date': { datum: '1992-01-15' }, 'Certificate Program': 'PK FRZ', 'WE All Passed': 'yes', 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2023-09-02' } },
        { 'Last Name': 'Neu', 'First Name': 'Nora', 'Birth Date': { datum: '1995-05-05' }, 'Certificate Program': 'IK', 'Certificate Language': 'DE', 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2026-09-09' } },
      ],
      issued: [],
    });
    const b = await importiere(pool, datei, { probelauf: false, heute: HEUTE });
    expect(b.faelle).toEqual({ neu: 0, vorhanden: 3, fehler: 0 });
    expect(b.runs).toEqual({ neu: 1, ergaenzt: 1, vorhanden: 2 });

    const bruno = await fall('Beispiel', 'AFFL');
    expect(bruno.status).toBe('bestanden');
    expect(bruno.kuba_herkunft).toBe('First Certification:11');
    const oe = (await runs(bruno.id)).find((r: any) => r.art === 'muendlich');
    expect(oe).toMatchObject({ bestanden: true, resultat_prozent: '85.00', ort: 'Zuerich' });
    expect(oe.experte1_id).not.toBeNull();

    const clara = await fall('Exempel', 'PK');
    expect(clara.status).toBe('nicht_bestanden');
    expect((await runs(clara.id))[0]).toMatchObject({ datum: '2023-09-01', bestanden: false });
    expect(b.dq).toContainEqual(expect.objectContaining({ zeile: 12, grund: expect.stringMatching(/WE1 RUN1 weicht vom ERP ab.*nicht ueberschrieben/) }));

    const n = await fall('Neu', 'IK');
    expect(n).toMatchObject({ id: nora.id, status: 'in_pruefung', kuba_herkunft: 'First Certification:13' });
    expect(await anzahl('outbox')).toBe(outboxVorher);
  });

  it('Fehler in einem Vorgang verwirft nur diesen Vorgang; neu angelegte Personen werden mit zurueckgerollt', async () => {
    await pool.query(`alter table saq_fall add constraint test_kein_kmu check (profil <> 'KMU')`);
    try {
      const fritz = { 'Last Name': 'Fehler', 'First Name': 'Fritz', 'Birth Date': { datum: '1970-01-01' }, 'Certificate Language': 'DE' };
      const datei = baueKubaXlsx({
        first: [
          { ...fritz, 'Certificate Program': 'KMU', 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2025-01-01' }, 'OE1 RUN1 Date': { datum: '2025-02-01' }, 'OE1 RUN1 Expert 1': 'Neuer Experte' },
          { ...fritz, 'Certificate Program': 'PK', 'OE1 RUN1 Date': { datum: '2025-03-01' }, 'OE1 RUN1 Expert 1': 'Neuer Experte' },
        ],
        issued: [],
      });
      const b = await importiere(pool, datei, { probelauf: false, heute: HEUTE });
      expect(b.faelle).toEqual({ neu: 1, vorhanden: 0, fehler: 1 });
      expect(b.fehler).toEqual([{ herkunft: 'First Certification:11', grund: expect.stringMatching(/test_kein_kmu/) }]);
      expect(b.dq).toContainEqual(expect.objectContaining({ stufe: 'fehler', zeile: 11, grund: expect.stringMatching(/^Vorgang nicht importiert/) }));
      expect(b.personen).toMatchObject({ neu: 1 });
      expect(b.experten).toMatchObject({ neu: 1 });
      expect(await anzahl('kontakt where nachname=$1', ['Fehler'])).toBe(1);
      expect(await anzahl(`referent where anzeigename='Neuer Experte'`)).toBe(1);
      expect((await fall('Fehler', 'PK')).status).toBe('in_pruefung');
    } finally {
      await pool.query('alter table saq_fall drop constraint test_kein_kmu');
    }
  });
});
