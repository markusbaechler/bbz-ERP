import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { arbeitstageZwischen, saqAnnullation } from '../src/domain/saqAnnullation';
import { createSaqFall, planePruefung } from '../src/repos/saqRepo';
import { verrechneSaqFall, storniereSaqFall } from '../src/repos/saqVerrechnungRepo';
import { createKursangebot } from '../src/repos/kursangebotRepo';
import { createDurchfuehrung, setDurchfuehrungStatus } from '../src/repos/durchfuehrungRepo';
import { meldeAn, bestaetigeAnmeldung, storniereAnmeldung } from '../src/repos/anmeldungRepo';
import { ConflictError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); });
afterAll(async () => { await closePool(); });

describe('SAQ-Annullation (AGB)', () => {
  it('zaehlt Arbeitstage Mo-Fr', () => {
    expect(arbeitstageZwischen('2027-03-05', '2027-03-12')).toBe(5);   // Fr -> Fr
    expect(arbeitstageZwischen('2027-03-12', '2027-03-12')).toBe(0);
  });
  it('Stufen: >30 Tage frei, bis 11 Arbeitstage CHF 300, darunter voller Preis bzw. CHF 300 mit Arztzeugnis, Admin CHF 150', () => {
    const p = { preisChf: 2025, schriftlichAbsolviert: true };
    expect(saqAnnullation({ ...p, stornoDatum: '2027-01-01', naechstePruefung: '2027-03-01' }).gebuehrChf).toBe(0);
    expect(saqAnnullation({ ...p, stornoDatum: '2027-02-08', naechstePruefung: '2027-03-01' }).gebuehrChf).toBe(300);
    expect(saqAnnullation({ ...p, stornoDatum: '2027-02-22', naechstePruefung: '2027-03-01' }).gebuehrChf).toBe(2025);
    expect(saqAnnullation({ ...p, stornoDatum: '2027-02-22', naechstePruefung: '2027-03-01', arztzeugnis: true }).gebuehrChf).toBe(300);
    expect(saqAnnullation({ preisChf: 2025, schriftlichAbsolviert: false, stornoDatum: '2027-01-01', naechstePruefung: '2027-03-01' }))
      .toMatchObject({ gebuehrChf: 150, regel: expect.stringContaining('Administrationsgebuehr') });
  });
});

describe('SAQ-Verrechnung', () => {
  async function fall(email: string) {
    return createSaqFall(pool, { kontakt: { email, nachname: 'Beispiel', vorname: 'Sara' }, profil: 'AFFL',
      rechnungsempfaengerId: base.auftraggeber.id, einwilligungRechnungBank: true });
  }
  it('verrechnet Listenpreis des Profils + Remote-Aufpreis mit MWSt, einmalig', async () => {
    const f = await fall('sara@bank.test');
    await planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2027-03-01', remote: true });
    const r = await verrechneSaqFall(pool, f.id, { datum: '2027-02-01', projektId: base.projekt.id });
    expect(r.positionen.map((p) => [p.einzelpreis, p.mwstSatz])).toEqual([[3025, 8.1], [300, 8.1]]);
    expect(r.totalNetto).toBe(3325);
    await expect(verrechneSaqFall(pool, f.id, { datum: '2027-02-01', projektId: base.projekt.id })).rejects.toBeInstanceOf(ConflictError);
  });
  it('Abmeldung kurz vor der Pruefung verrechnet die Annullationskosten', async () => {
    const f = await fall('kurz@bank.test');
    await planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2027-03-01' });
    const s = await storniereSaqFall(pool, f.id, { datum: '2027-02-08', grund: 'Stellenwechsel', projektId: base.projekt.id });
    expect(s.annullation.gebuehrChf).toBe(300);
    expect(s.rechnungId).not.toBeNull();
    const st = await pool.query('select status, stornogebuehr_chf from saq_fall where id=$1', [f.id]);
    expect(st.rows[0]).toEqual({ status: 'abgebrochen', stornogebuehr_chf: '300.00' });
    await expect(storniereSaqFall(pool, f.id, { datum: '2027-02-09', grund: 'nochmals' })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('Annullationsregel "projekt" (Firmenkurse, AGB 90/60/30)', () => {
  it('berechnet 50 % bei Storno 40 Tage vor Beginn', async () => {
    const ka = await createKursangebot(pool, { code: 'TAIL', titel: 'Firmenkurs Beratung', bereich: 'Beratung', preisChf: 1000, annullationsregel: 'projekt' });
    const d = await createDurchfuehrung(pool, { kursangebotId: ka.id, projektId: base.projekt.id, startDatum: '2027-05-10', endDatum: '2027-05-10' });
    await setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben');
    const a = await meldeAn(pool, d.id, { kontakt: { email: 'tail@bank.test', nachname: 'Tail' } });
    await bestaetigeAnmeldung(pool, a.anmeldung.id);
    const s = await storniereAnmeldung(pool, a.anmeldung.id, { grund: 'verschoben', datum: '2027-03-31' });
    expect(s.anmeldung.stornogebuehrChf).toBe(500);
  });
});
