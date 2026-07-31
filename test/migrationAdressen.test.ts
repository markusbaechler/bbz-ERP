import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fmStrasse, fmLand, leseAdressen, importAdressen } from '../src/migration/adressen';
import {
  upsertAuftraggeberAusMigration, findAuftraggeberByNummer, listAuftraggeber,
} from '../src/repos/auftraggeberRepo';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/adressen_mini.csv');
const text = () => readFileSync(fixture, 'utf8');

// Die Adressen kommen als eigener Export nach dem Projekt-Import. Der Nachtrag setzt
// deshalb nur voraus, dass die Auftraggeber schon da sind — nicht, dass im selben Lauf
// Projekte importiert wurden. Genau so wird hier vorbereitet.
beforeAll(async () => {
  await resetDb(getPool());
  for (const [nummer, name, zusatz] of [
    ['1285', 'Connect KB (ehem.) WOB', null],
    ['1260', 'Universität St. Gallen', 'Institut für Banken und Finanzen'],
    ['20577', 'bbz st.gallen ag', null],
    ['1124', 'Liechtensteinische Landesbank AG', null],
  ] as Array<[string, string, string | null]>) {
    await upsertAuftraggeberAusMigration(getPool(), { nummer, name, zusatz });
  }
});
afterAll(async () => { await closePool(); });

describe('fmStrasse', () => {
  it('nimmt die Strasse unveraendert, wenn sie einzeilig ist', () => {
    expect(fmStrasse('Bahnhofstrasse 1', '')).toBe('Bahnhofstrasse 1');
    expect(fmStrasse('', '')).toBeNull();
    expect(fmStrasse(undefined, undefined)).toBeNull();
  });

  // "Gurtengasse 6\nPostfach" ist im echten Export die einzige mehrzeilige Strasse.
  // Beide Zeilen sind fuer die Zustellung relevant, das Adressfeld der QR-Rechnung
  // ist einzeilig — darum mit Komma verbunden statt eine Zeile wegzuwerfen.
  it('verbindet eine mehrzeilige Strasse mit Komma', () => {
    expect(fmStrasse('Gurtengasse 6\nPostfach', '')).toBe('Gurtengasse 6, Postfach');
  });

  // Strasse_Nr. ist nur in 3 von 49 Zeilen gefuellt; sonst steckt die Hausnummer
  // bereits in Strasse.
  it('haengt eine separat gefuehrte Hausnummer an die erste Zeile', () => {
    expect(fmStrasse('Bederstrasse', '49')).toBe('Bederstrasse 49');
    expect(fmStrasse('Hauptstrasse\nPostfach', '67')).toBe('Hauptstrasse 67, Postfach');
  });
});

describe('fmLand', () => {
  it('uebernimmt ein vorhandenes Land unveraendert', () => {
    expect(fmLand('FL', '9490', 'Vaduz')).toEqual({ wert: 'FL', angenommen: false });
    expect(fmLand('CH', '9000', 'St. Gallen')).toEqual({ wert: 'CH', angenommen: false });
  });

  it('nimmt bei leerem Land CH an, wenn PLZ vierstellig und Ort gefuellt ist', () => {
    expect(fmLand('', '9000', 'St. Gallen')).toEqual({ wert: 'CH', angenommen: true });
  });

  it('nimmt nichts an, wenn PLZ oder Ort das nicht hergeben', () => {
    expect(fmLand('', '86956', 'Schongau')).toEqual({ wert: null, angenommen: false });
    expect(fmLand('', '9000', '')).toEqual({ wert: null, angenommen: false });
    expect(fmLand('', '', '')).toEqual({ wert: null, angenommen: false });
  });
});

describe('leseAdressen', () => {
  it('liest nur Zeilen mit Kunden Nr. — Folgezeilen des Exports zaehlen nicht', () => {
    const r = leseAdressen(text());
    expect(r.zeilenGesamt).toBe(7);   // 5 Adressen + 2 Folgezeilen ohne Kunden Nr.
    expect(r.adressen.map((a) => a.nummer)).toEqual(['1285', '1260', '20577', '1124', '88888']);
  });
});

describe('Adressen-Nachtrag (dry-run)', () => {
  it('schreibt nichts und meldet trotzdem, was ein Apply taete', async () => {
    const r = await importAdressen(getPool(), { quelle: fixture, text: text(), modus: 'dry-run' });
    expect(r.geschrieben).toBe(3);
    expect(r.unvollstaendig).toBe(1);
    expect(r.ohneTreffer).toBe(1);

    const ag = await findAuftraggeberByNummer(getPool(), '1285');
    expect(ag?.strasse).toBe('');
    expect(ag?.adresseUnvollstaendig).toBe(true);
  });
});

describe('Adressen-Nachtrag (apply)', () => {
  it('traegt die vollstaendigen Adressen nach und hebt die Sperre', async () => {
    const r = await importAdressen(getPool(), { quelle: fixture, text: text(), modus: 'apply' });
    expect(r.eintraege).toBe(5);
    expect(r.getroffen).toBe(4);
    expect(r.ohneTreffer).toBe(1);      // 88888 steht nicht in der Datenbank
    expect(r.geschrieben).toBe(3);
    expect(r.unvollstaendig).toBe(1);   // 20577 ohne Strasse/PLZ/Ort

    const ag = await findAuftraggeberByNummer(getPool(), '1285');
    expect(ag?.strasse).toBe('Bahnhofstrasse 3');
    expect(ag?.plz).toBe('6003');
    expect(ag?.ort).toBe('Luzern');
    expect(ag?.land).toBe('CH');
    expect(ag?.adresseUnvollstaendig).toBe(false);
  });

  it('legt niemals einen Auftraggeber an', async () => {
    expect((await listAuftraggeber(getPool())).map((a) => a.nummer).sort())
      .toEqual(['1124', '1260', '1285', '20577']);
  });

  it('laesst Name und Zusatz unangetastet und haelt die Abweichung als Befund fest', async () => {
    const ag = await findAuftraggeberByNummer(getPool(), '1285');
    expect(ag?.name).toBe('Connect KB (ehem.) WOB');   // nicht "Connect KB WOB" aus der Adressdatei
    const ag2 = await findAuftraggeberByNummer(getPool(), '1260');
    expect(ag2?.zusatz).toBe('Institut für Banken und Finanzen');

    const r = await importAdressen(getPool(), { quelle: fixture, text: text(), modus: 'dry-run' });
    expect(r.datenbefunde.some((d) => d.includes('1285') && d.includes('Connect KB WOB'))).toBe(true);
  });

  it('verbindet die mehrzeilige Strasse und nimmt das fehlende Land als CH an', async () => {
    const ag = await findAuftraggeberByNummer(getPool(), '1260');
    expect(ag?.strasse).toBe('Unterer Graben 21, Postfach');
    expect(ag?.land).toBe('CH');

    const r = await importAdressen(getPool(), { quelle: fixture, text: text(), modus: 'dry-run' });
    // Jede Annahme wird einzeln genannt — sie ist eine Schlussfolgerung, keine Quelle.
    expect(r.datenbefunde.filter((d) => d.includes('1260') && d.includes('CH')).length).toBe(1);
  });

  // Das Land steht im QR-Beleg; ein stillschweigendes "CH" waere dort ein falscher Beleg.
  it('laesst ein bereits gefuehrtes Land unveraendert (FL bleibt FL)', async () => {
    const ag = await findAuftraggeberByNummer(getPool(), '1124');
    expect(ag?.land).toBe('FL');
    expect(ag?.strasse).toBe('Städtle 44');
    expect(ag?.adresseUnvollstaendig).toBe(false);
  });

  // Eine halbe Adresse saehe in der Datenbank aus wie eine ganze und wuerde die
  // Festschreibung freigeben — darum gar nicht erst schreiben.
  it('schreibt eine unvollstaendige Adresse nicht als halbe Adresse', async () => {
    const ag = await findAuftraggeberByNummer(getPool(), '20577');
    expect(ag?.strasse).toBe('');
    expect(ag?.plz).toBe('');
    expect(ag?.ort).toBe('');
    expect(ag?.adresseUnvollstaendig).toBe(true);
  });

  it('nennt die weiterhin gesperrten Auftraggeber mit Nummer und Namen', async () => {
    const r = await importAdressen(getPool(), { quelle: fixture, text: text(), modus: 'dry-run' });
    expect(r.nochOhneAdresse).toEqual([{ nummer: '20577', name: 'bbz st.gallen ag' }]);
    expect(r.warnungen.some((w) => w.includes('20577') && w.includes('bbz st.gallen ag'))).toBe(true);
  });

  it('ist idempotent: der zweite Lauf schreibt nichts mehr', async () => {
    const r = await importAdressen(getPool(), { quelle: fixture, text: text(), modus: 'apply' });
    expect(r.geschrieben).toBe(0);
    expect(r.unveraendert).toBe(3);
    expect(r.unvollstaendig).toBe(1);
  });
});
