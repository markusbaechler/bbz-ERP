// Mahnwesen (Spec v2 §5.5): Mahnvorschlag zum Stichtag, Mahnlauf (idempotent je Rechnung+Stufe), Mahnungen je Rechnung.
// Stufenregeln in src/domain/mahnwesen.ts; offene Posten und offene Betraege aus debitorRepo (v1).
import type pg from 'pg';
import { offenePosten, offenerBetrag, summeBezahlt } from './debitorRepo';
import { type Db, inTransaktion, num } from './db';
import { enqueue } from './outboxRepo';
import { audit } from './auditRepo';
import { beurteileMahnung, pruefeStichtag, stufe, type BisherigeMahnung } from '../domain/mahnwesen';
import { ValidationError } from '../domain/errors';

export type Mahnung = {
  id: string; rechnungId: string; stufe: number; bezeichnung: string; datum: string; fristBis: string;
  gebuehrChf: number; offenChf: number; erstelltDurch: string | null; erstelltAm: string;
};

export type MahnvorschlagPosten = {
  rechnungId: string; nummer: string | null; auftraggeberId: string; datum: string; faelligAm: string; offen: number;
  letzteStufe: number | null; naechsteStufe: number | null; gebuehr: number; inkasso: boolean;
};

const mapMahnung = (r: any): Mahnung => ({
  id: r.id, rechnungId: r.rechnung_id, stufe: r.stufe, bezeichnung: stufe(r.stufe).bezeichnung, datum: r.datum,
  fristBis: r.frist_bis, gebuehrChf: Number(r.gebuehr_chf), offenChf: Number(r.offen_chf), erstelltDurch: r.erstellt_durch,
  erstelltAm: new Date(r.erstellt_am).toISOString(),
});

export async function listMahnungen(db: Db, rechnungId: string): Promise<Mahnung[]> {
  const r = await db.query('select * from mahnung where rechnung_id=$1 order by stufe', [rechnungId]);
  return r.rows.map(mapMahnung);
}

async function bisherigeJeRechnung(db: Db, ids: string[]): Promise<Map<string, BisherigeMahnung[]>> {
  const r = await db.query('select rechnung_id, stufe, frist_bis from mahnung where rechnung_id = any($1::uuid[])', [ids]);
  const m = new Map<string, BisherigeMahnung[]>();
  for (const x of r.rows) m.set(x.rechnung_id, [...(m.get(x.rechnung_id) ?? []), { stufe: x.stufe, fristBis: x.frist_bis }]);
  return m;
}

/**
 * Ueberfaellige offene Posten (festgeschrieben, offen > 0, Faelligkeit vor dem Stichtag) mit letzter und naechster
 * Stufe. Posten, deren Frist noch laeuft (naechsteStufe = null) oder die im Inkasso sind, bleiben sichtbar.
 */
export async function mahnvorschlag(pool: pg.Pool, stichtag: string): Promise<MahnvorschlagPosten[]> {
  pruefeStichtag(stichtag);
  const posten = await offenePosten(pool);
  if (!posten.length) return [];
  const ids = posten.map((p) => p.rechnungId);
  const fristen = new Map<string, number>(
    (await pool.query('select id, zahlungsfrist_tage from rechnung where id = any($1::uuid[])', [ids])).rows.map((r: any) => [r.id, r.zahlungsfrist_tage]));
  const bisher = await bisherigeJeRechnung(pool, ids);
  return posten
    .map((p) => {
      const b = beurteileMahnung({ datum: p.datum, zahlungsfristTage: fristen.get(p.rechnungId) }, bisher.get(p.rechnungId) ?? [], stichtag);
      return { p, b };
    })
    .filter(({ b }) => b.ueberfaellig)
    .map(({ p, b }) => ({
      rechnungId: p.rechnungId, nummer: p.nummer, auftraggeberId: p.auftraggeberId, datum: p.datum, faelligAm: b.faelligAm,
      offen: p.offen, letzteStufe: b.letzteStufe, naechsteStufe: b.naechsteStufe, gebuehr: b.gebuehr, inkasso: b.inkasso,
    }))
    .sort((a, b) => a.faelligAm.localeCompare(b.faelligAm) || String(a.nummer).localeCompare(String(b.nummer)));
}

/**
 * Mahnlauf: erzeugt fuer jeden vorgeschlagenen Posten (optional nur `rechnungIds`) die naechste Mahnung, in EINER
 * Transaktion. Je Rechnung wird die Zeile gesperrt (serialisiert mit erfasseZahlung) und die Stufe mit frischen Daten
 * neu beurteilt; `unique (rechnung_id, stufe)` + `on conflict do nothing` machen den Lauf idempotent. Je Mahnung ein
 * Mail-Auftrag (Outbox, Vorlage "mahnung") und ein Audit-Eintrag. Die Gebuehr ist informativ (keine Gebuehrenrechnung).
 */
export async function mahnlauf(pool: pg.Pool, input: { stichtag: string; rechnungIds?: string[] }, benutzer: string | null = null): Promise<{ stichtag: string; mahnungen: Mahnung[] }> {
  const stichtag = pruefeStichtag(input.stichtag);
  const nur = input.rechnungIds;
  if (nur !== undefined && (!Array.isArray(nur) || nur.some((x) => typeof x !== 'string'))) {
    throw new ValidationError('rechnungIds muss eine Liste von IDs sein');
  }
  const kandidaten = (await mahnvorschlag(pool, stichtag))
    .filter((p) => p.naechsteStufe !== null && (!nur || nur.includes(p.rechnungId)));

  return inTransaktion(pool, async (c) => {
    const mahnungen: Mahnung[] = [];
    for (const k of kandidaten) {
      const rr = await c.query(
        `select r.status, r.datum, r.zahlungsfrist_tage, r.total_brutto, a.email
         from rechnung r join auftraggeber a on a.id = r.auftraggeber_id where r.id=$1 for update of r`, [k.rechnungId]);
      const r = rr.rows[0];
      if (!r || r.status !== 'abgerechnet') continue;
      // Zeilensperre gehalten: erfasseZahlung wartet darauf, die Summe ist damit konsistent.
      const offen = offenerBetrag(Number(r.total_brutto), await summeBezahlt(pool, k.rechnungId));
      if (offen <= 0) continue;
      const bisher = (await bisherigeJeRechnung(c, [k.rechnungId])).get(k.rechnungId) ?? [];
      const b = beurteileMahnung({ datum: r.datum, zahlungsfristTage: num(r.zahlungsfrist_tage) }, bisher, stichtag);
      if (b.naechsteStufe === null) continue;
      const ins = await c.query(
        `insert into mahnung(rechnung_id,stufe,datum,frist_bis,gebuehr_chf,offen_chf,erstellt_durch)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (rechnung_id, stufe) do nothing returning *`,
        [k.rechnungId, b.naechsteStufe, stichtag, b.fristBis, b.gebuehr, offen, benutzer]);
      if (!ins.rowCount) continue;
      const m = mapMahnung(ins.rows[0]);
      await enqueue(c, 'mail', m.id, { vorlage: 'mahnung', an: r.email ?? null, daten: { rechnungId: m.rechnungId, stufe: m.stufe } });
      await audit(c, {
        benutzer, aktion: 'mahnung.erstellt', entitaet: 'rechnung', entitaetId: m.rechnungId,
        details: { mahnungId: m.id, stufe: m.stufe, fristBis: m.fristBis, gebuehrChf: m.gebuehrChf, offenChf: m.offenChf },
      });
      mahnungen.push(m);
    }
    await audit(c, {
      benutzer, aktion: 'mahnlauf', entitaet: 'mahnlauf', entitaetId: stichtag,
      details: { stichtag, anzahl: mahnungen.length, rechnungIds: mahnungen.map((m) => m.rechnungId), eingeschraenkt: !!nur },
    });
    return { stichtag, mahnungen };
  });
}
