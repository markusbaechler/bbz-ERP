import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { findKontoByNummer, upsertKonto } from '../src/repos/kontoRepo';
import { upsertMwstSatz, findGueltigenSatz } from '../src/repos/mwstSatzRepo';
import { findAuftraggeberByNummer, upsertAuftraggeberAusMigration, createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { upsertProjektAusMigration, projektSummen, getJahresverlauf } from '../src/repos/projektRepo';
import { getZaehler, setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import { ValidationError } from '../src/domain/errors';
import type { MigrationProjektInput } from '../src/domain/types';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('konto-Upsert', () => {
  it('legt an und ist beim zweiten Lauf idempotent', async () => {
    const a = await upsertKonto(getPool(), { nummer: '3100', bezeichnung: 'Ertrag Banking', typ: 'Ertrag' });
    expect(a.neu).toBe(true);
    const b = await upsertKonto(getPool(), { nummer: '3100', bezeichnung: 'Ertrag Banking', typ: 'Ertrag' });
    expect(b.neu).toBe(false);
    expect(b.konto.id).toBe(a.konto.id);
    expect((await findKontoByNummer(getPool(), '3100'))?.id).toBe(a.konto.id);
    expect(await findKontoByNummer(getPool(), '9999')).toBeNull();
  });
});

describe('mwst_satz-Upsert', () => {
  it('ist idempotent ueber Satz und Gueltigkeitsbeginn', async () => {
    const a = await upsertMwstSatz(getPool(), { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01' });
    const b = await upsertMwstSatz(getPool(), { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01' });
    expect(a.neu).toBe(true);
    expect(b.neu).toBe(false);
    expect((await findGueltigenSatz(getPool(), 8.1, '2026-07-23')).id).toBe(a.mwstSatz.id);
  });

  it('erlaubt denselben Satz in zwei Perioden', async () => {
    await upsertMwstSatz(getPool(), { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2011-01-01', gueltigBis: '2017-12-31' });
    await upsertMwstSatz(getPool(), { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2024-01-01' });
    expect((await findGueltigenSatz(getPool(), 3.8, '2015-06-01')).gueltigBis).toBe('2017-12-31');
    expect((await findGueltigenSatz(getPool(), 3.8, '2026-06-01')).gueltigBis).toBeNull();
  });
});

describe('auftraggeber-Upsert aus Migration', () => {
  it('legt ohne Adresse an und markiert sie als unvollstaendig', async () => {
    const r = await upsertAuftraggeberAusMigration(getPool(), { nummer: '1069', name: 'Urner Kantonalbank', ansprechperson: 'Peter Muster' });
    expect(r.neu).toBe(true);
    expect(r.auftraggeber.adresseUnvollstaendig).toBe(true);
    expect(r.auftraggeber.strasse).toBe('');
    expect((await findAuftraggeberByNummer(getPool(), '1069'))?.name).toBe('Urner Kantonalbank');
  });

  it('uebernimmt den Zusatz mehrzeiliger Namen', async () => {
    const r = await upsertAuftraggeberAusMigration(getPool(), { nummer: '1260', name: 'Universität St. Gallen', zusatz: 'Institut für Banken und Finanzen' });
    expect(r.auftraggeber.zusatz).toBe('Institut für Banken und Finanzen');
  });

  it('ueberschreibt eine bereits erfasste Adresse nicht', async () => {
    await createAuftraggeber(getPool(), { nummer: '1117', name: 'Schwyzer KB', strasse: 'Bahnhofstr. 3', plz: '6430', ort: 'Schwyz' });
    const r = await upsertAuftraggeberAusMigration(getPool(), { nummer: '1117', name: 'Schwyzer Kantonalbank' });
    expect(r.neu).toBe(false);
    expect(r.auftraggeber.name).toBe('Schwyzer Kantonalbank');
    expect(r.auftraggeber.strasse).toBe('Bahnhofstr. 3');
    expect(r.auftraggeber.adresseUnvollstaendig).toBe(false);
  });
});

describe('projekt-Upsert aus Migration', () => {
  const basis = (over: Partial<MigrationProjektInput> = {}): MigrationProjektInput => ({
    stammnummer: 6231, jahr: 2026, name: 'Ausgaben bbz', auftraggeberId: '', kuerzel: null,
    bereich: null, beschrieb: null, ansprechperson: null, ertragskontoId: null, aufwandKontoId: null,
    budgetChf: 1000, budgetTage: null, aufwandBudgetChf: null, fmOffenProv: 400, fmAbgerechnet: 600,
    alteProjektNr: '6231.25', projektleitungKuerzel: 'ml', mwstModus: 'exkl',
    erstelltDurch: 'p.meier', geaendertDurch: 'm.lippuner', ...over,
  });

  it('legt an, aktualisiert beim zweiten Lauf und haelt die Nummer stabil', async () => {
    const ag = await upsertAuftraggeberAusMigration(getPool(), { nummer: '20577', name: 'bbz st.gallen ag' });
    const a = await upsertProjektAusMigration(getPool(), basis({ auftraggeberId: ag.auftraggeber.id }));
    expect(a.neu).toBe(true);
    expect(a.projekt.nummer).toBe('6231.26');

    const b = await upsertProjektAusMigration(getPool(), basis({ auftraggeberId: ag.auftraggeber.id, name: 'Ausgaben bbz (neu)', budgetChf: 1500 }));
    expect(b.neu).toBe(false);
    expect(b.projekt.id).toBe(a.projekt.id);
    expect(b.projekt.name).toBe('Ausgaben bbz (neu)');
    expect(b.projekt.budgetChf).toBe(1500);
    expect(await getJahresverlauf(getPool(), 6231)).toHaveLength(1);
  });

  it('liefert die Jahressummen fuer den Abgleich', async () => {
    const s = await projektSummen(getPool(), 2026);
    expect(s.anzahl).toBe(1);
    expect(s.budgetChf).toBe(1500);
    expect(s.offenProv).toBe(400);
    expect(s.abgerechnet).toBe(600);
  });
});

describe('zaehlerRepo', () => {
  it('startet bei 0 und laesst sich hochsetzen', async () => {
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(0);
    expect(await setzeRechnungZaehler(getPool(), 33214)).toBe(33214);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });

  it('verweigert das Zuruecksetzen', async () => {
    await expect(setzeRechnungZaehler(getPool(), 31491)).rejects.toBeInstanceOf(ValidationError);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });
});
