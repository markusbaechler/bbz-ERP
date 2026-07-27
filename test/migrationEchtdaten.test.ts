import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fuehreMigrationAus } from '../src/migration/run';
import { findAuftraggeberByNummer, listAuftraggeber } from '../src/repos/auftraggeberRepo';
import { listProjekte } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { setzeRechnungZaehler } from '../src/repos/zaehlerRepo';

// Liegt ausserhalb des Repos (Personen-/Bankdaten werden nicht eingecheckt).
const echt = join(dirname(fileURLToPath(import.meta.url)), '../../fm-discovery/export/export_daten.csv');
const echtAdressen = join(dirname(fileURLToPath(import.meta.url)), '../../fm-discovery/export/adressen_export.csv');
const vorhanden = existsSync(echt);
const adressenVorhanden = existsSync(echtAdressen);

beforeAll(async () => { if (vorhanden) await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe.skipIf(!vorhanden)('Migration gegen den echten Projekt-Export', () => {
  it('importiert 151 Projekte und 49 Auftraggeber mit passenden Summen', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: echt, modus: 'apply' });
    expect(r.jahr).toBe(2026);
    expect(r.projekte.gelesen).toBe(151);
    expect(r.projekte.neu).toBe(151);
    expect(r.projekte.uebersprungen).toBe(0);
    expect(r.auftraggeber.gelesen).toBe(49);

    // Sollwerte aus dem FileMaker-Export (Befund B1)
    expect(r.summen.budgetChf.csv).toBeCloseTo(4435265.0, 2);
    expect(r.summen.offenProv.csv).toBeCloseTo(2048973.45, 2);
    expect(r.summen.abgerechnet.csv).toBeCloseTo(2401554.55, 2);

    // Datenbank stimmt mit der CSV ueberein
    expect(r.summen.budgetChf.ok).toBe(true);
    expect(r.summen.offenProv.ok).toBe(true);
    expect(r.summen.abgerechnet.ok).toBe(true);

    // Bekannte, erwartete Datenluecken (Befunde B3/B4)
    expect(r.auftraggeber.ohneAdresse).toBe(49);
    expect(r.warnungen.filter((w) => w.includes('nicht im Kontenplan')).length).toBeGreaterThan(0);
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: echt, modus: 'apply' });
    expect(r.projekte.neu).toBe(0);
    expect(r.projekte.aktualisiert).toBe(151);
    expect(r.auftraggeber.neu).toBe(0);
  });
});

// Laeuft im selben File und damit auf demselben Datenstand wie oben: die 49
// Auftraggeber sind importiert und alle mit adresse_unvollstaendig markiert.
describe.skipIf(!vorhanden || !adressenVorhanden)('Adressen-Nachtrag gegen den echten Adressexport', () => {
  it('traegt 48 von 49 Adressen nach — nur der interne Auftraggeber bleibt gesperrt', async () => {
    const r = await fuehreMigrationAus(getPool(), { adressenCsv: echtAdressen, modus: 'apply' });
    const a = r.adressen!;
    expect(a.eintraege).toBe(937);
    expect(a.getroffen).toBe(49);
    expect(a.ohneTreffer).toBe(888);      // Adressen ohne Auftraggeber — es wird keiner angelegt
    expect(a.geschrieben).toBe(48);
    expect(a.unvollstaendig).toBe(1);
    expect(a.nochOhneAdresse).toEqual([{ nummer: '20577', name: 'bbz st.gallen ag' }]);

    // Kein Auftraggeber dazugekommen: die Datei hat 937 Zeilen, die Datenbank 49.
    expect((await listAuftraggeber(getPool())).length).toBe(49);
  });

  // Land steht im QR-Beleg. 11 der 49 Zeilen fuehren kein Land; bei 10 davon laesst
  // sich CH aus vierstelliger PLZ und gefuelltem Ort erschliessen, bei 20577 nicht
  // (dort ist die ganze Adresse leer). Jede Annahme wird einzeln genannt.
  it('nennt jede CH-Annahme einzeln und laesst FL unangetastet', async () => {
    const r = await fuehreMigrationAus(getPool(), { adressenCsv: echtAdressen, modus: 'dry-run' });
    expect(r.datenbefunde.filter((d) => d.includes('"CH" angenommen')).length).toBe(10);

    const llb = await findAuftraggeberByNummer(getPool(), '1124');
    expect(llb?.land).toBe('FL');
    expect(llb?.ort).toBe('Vaduz');
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await fuehreMigrationAus(getPool(), { adressenCsv: echtAdressen, modus: 'apply' });
    expect(r.adressen!.geschrieben).toBe(0);
    expect(r.adressen!.unveraendert).toBe(48);
    expect(r.adressen!.unvollstaendig).toBe(1);
  });

  // Der eigentliche Zweck der ganzen Uebung: vor dem Nachtrag wies die Festschreibung
  // jeden dieser 49 Auftraggeber ab (adresse_unvollstaendig), jetzt nicht mehr.
  it('macht ein Projekt eines nachgetragenen Auftraggebers fakturierbar', async () => {
    const ag = await findAuftraggeberByNummer(getPool(), '1260');   // Universitaet St. Gallen
    expect(ag?.adresseUnvollstaendig).toBe(false);
    expect(ag?.strasse).toBeTruthy();

    const projekt = (await listProjekte(getPool(), { auftraggeberId: ag!.id }))[0];
    expect(projekt).toBeDefined();

    const rechnung = await createRechnung(getPool(), {
      projektId: projekt.id, auftraggeberId: ag!.id, datum: '2026-07-27',
    });
    await addPosition(getPool(), rechnung.id, {
      beschreibung: 'Seminarleitung', menge: 1, einzelpreis: 1000, mwstSatz: 8.1,
    });
    await setzeRechnungZaehler(getPool(), 33214, 'Test Adressen-Nachtrag');

    const fest = await festschreiben(getPool(), rechnung.id, 'ml');
    expect(fest.status).toBe('abgerechnet');
    expect(fest.lfdNr).toBe(33215);
    expect(fest.nummer).toContain('33215');
  });

  // Gegenprobe: der interne Auftraggeber bleibt gesperrt — kein Kollateralschaden
  // durch das Nachtragen der uebrigen 48.
  it('weist den weiterhin unvollstaendigen Auftraggeber unveraendert ab', async () => {
    const ag = await findAuftraggeberByNummer(getPool(), '20577');
    expect(ag?.adresseUnvollstaendig).toBe(true);

    const projekt = (await listProjekte(getPool(), { auftraggeberId: ag!.id }))[0];
    const rechnung = await createRechnung(getPool(), {
      projektId: projekt.id, auftraggeberId: ag!.id, datum: '2026-07-27',
    });
    await addPosition(getPool(), rechnung.id, {
      beschreibung: 'Intern', menge: 1, einzelpreis: 100, mwstSatz: 8.1,
    });
    await expect(festschreiben(getPool(), rechnung.id, 'ml')).rejects.toThrow(/Adresse/i);
  });
});
