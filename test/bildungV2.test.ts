import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createKursangebot, updateKursangebot } from '../src/repos/kursangebotRepo';
import { createDurchfuehrung, setDurchfuehrungStatus } from '../src/repos/durchfuehrungRepo';
import { meldeAn, bestaetigeAnmeldung } from '../src/repos/anmeldungRepo';
import { verrechneDurchfuehrung } from '../src/repos/bildungVerrechnungRepo';
import { ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); });
afterAll(async () => { await closePool(); });

describe('Bildung v2: Rezertifizierungs-/Nebenkostenfelder, Moodle-Session', () => {
  it('speichert und validiert die v2-Felder des Kursangebots', async () => {
    const ka = await createKursangebot(pool, { code: 'AFLZ', titel: 'Anlagefonds Lizenz', bereich: 'Banking', preisChf: 650,
      rezertProfile: ['PK', 'IK'], rezertKomponenten: ['fachwissen'], nebenkostenProTagChf: 135, homepagePostId: 4711 });
    expect(ka).toMatchObject({ rezertProfile: ['PK', 'IK'], rezertKomponenten: ['fachwissen'], nebenkostenProTagChf: 135, nebenkostenMwstSatz: 8.1, annullationsregel: 'oeffentlich', homepagePostId: 4711 });
    await expect(updateKursangebot(pool, ka.id, { rezertProfile: ['XYZ'] })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateKursangebot(pool, ka.id, { annullationsregel: 'irgendwas' as any })).rejects.toBeInstanceOf(ValidationError);
  });

  it('verrechnet Nebenkosten je Teilnehmer:in und Kurstag mit eigenem MWSt-Satz (Kurs selbst MWSt-befreit)', async () => {
    const ka = await createKursangebot(pool, { code: 'VSL2', titel: 'Vorsorge Lizenz', bereich: 'Banking', preisChf: 1500, mwstSatz: 0, nebenkostenProTagChf: 135 });
    const d = await createDurchfuehrung(pool, { kursangebotId: ka.id, projektId: base.projekt.id, startDatum: '2027-06-07', endDatum: '2027-06-08', kapazitaet: 5, moodleSessionId: 9001 });
    expect(d.moodleSessionId).toBe(9001);
    await setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben');
    const a = await meldeAn(pool, d.id, { kontakt: { email: 'nk@bank.test', nachname: 'Nebenkosten', vorname: 'Nina' }, rechnungsempfaengerId: base.auftraggeber.id });
    await bestaetigeAnmeldung(pool, a.anmeldung.id);
    const { rechnungen } = await verrechneDurchfuehrung(pool, d.id, { datum: '2027-06-09' });
    const [r] = rechnungen;
    expect(r.positionen.map((p) => [p.einheit, p.menge, p.einzelpreis, p.mwstSatz])).toEqual([['Pauschal', 1, 1500, 0], ['Tag', 2, 135, 8.1]]);
    expect(r.totalNetto).toBe(1770);
    expect(r.totalMwst).toBe(21.85);   // 270 * 8.1 % = 21.87 -> Rappenrundung 21.85
  });
});
