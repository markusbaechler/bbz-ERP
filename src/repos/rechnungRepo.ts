import type pg from 'pg';
import type { Rechnung, Rechnungsposition } from '../domain/types';
import { berechneMwst, rappenRunden } from '../domain/mwst';
import { ValidationError, NotFoundError } from '../domain/errors';
import { getProjektById } from './projektRepo';
import { type Db, inTransaktion } from './db';
import { audit } from './auditRepo';

const mapR = (r: any): Rechnung => ({
  id: r.id, projektId: r.projekt_id, auftraggeberId: r.auftraggeber_id, datum: r.datum,
  betreff: r.betreff, mwstModus: r.mwst_modus, waehrung: r.waehrung,
  lfdNr: r.lfd_nr === null ? null : Number(r.lfd_nr), nummer: r.nummer, status: r.status,
  totalNetto: Number(r.total_netto), totalMwst: Number(r.total_mwst), totalBrutto: Number(r.total_brutto),
  typ: r.typ ?? 'rechnung', bezugRechnungId: r.bezug_rechnung_id ?? null,
});

const mapP = (r: any): Rechnungsposition => ({
  id: r.id, rechnungId: r.rechnung_id, position: r.position, beschreibung: r.beschreibung,
  menge: Number(r.menge), einheit: r.einheit, einzelpreis: Number(r.einzelpreis),
  mwstSatz: Number(r.mwst_satz), kontoId: r.konto_id, betragNetto: Number(r.betrag_netto),
});

export async function createRechnung(pool: Db, input: { projektId: string; auftraggeberId: string; datum: string; betreff?: string | null; mwstModus?: 'exkl' | 'inkl'; waehrung?: string }): Promise<Rechnung> {
  const r = await pool.query(
    `insert into rechnung(projekt_id,auftraggeber_id,datum,betreff,mwst_modus,waehrung)
     values ($1,$2,$3,$4,coalesce($5,'exkl'),coalesce($6,'CHF')) returning *`,
    [input.projektId, input.auftraggeberId, input.datum, input.betreff ?? null, input.mwstModus ?? null, input.waehrung ?? null]);
  return mapR(r.rows[0]);
}

export async function getRechnung(pool: Db, id: string): Promise<Rechnung> {
  const r = await pool.query('select * from rechnung where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Rechnung ${id} nicht gefunden`);
  return mapR(r.rows[0]);
}

export async function listRechnungen(pool: Db, f: { projektId?: string; auftraggeberId?: string; status?: string; jahr?: number } = {}): Promise<Rechnung[]> {
  const args: unknown[] = []; const cond: string[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (f.projektId) add('projekt_id=?', f.projektId);
  if (f.auftraggeberId) add('auftraggeber_id=?', f.auftraggeberId);
  if (f.status) add('status=?', f.status);
  if (f.jahr) add('extract(year from datum)=?', f.jahr);
  const r = await pool.query(`select * from rechnung ${cond.length ? 'where ' + cond.join(' and ') : ''} order by datum desc, lfd_nr desc nulls first limit 1000`, args);
  return r.rows.map(mapR);
}

export async function listPositionen(pool: Db, rechnungId: string): Promise<Rechnungsposition[]> {
  const r = await pool.query('select * from rechnungsposition where rechnung_id=$1 order by position', [rechnungId]);
  return r.rows.map(mapP);
}

export async function recalcTotale(pool: Db, rechnungId: string): Promise<Rechnung> {
  const rechnung = await getRechnung(pool, rechnungId);
  const pos = await listPositionen(pool, rechnungId);
  const e = berechneMwst(pos.map((p) => ({ betrag: p.betragNetto, satz: p.mwstSatz })), rechnung.mwstModus);
  const upd = await pool.query(
    'update rechnung set total_netto=$2,total_mwst=$3,total_brutto=$4 where id=$1 returning *',
    [rechnungId, e.totalNetto, e.totalSteuer, e.totalBrutto]);
  return mapR(upd.rows[0]);
}

export async function addPosition(pool: Db, rechnungId: string, p: { beschreibung: string; menge: number; einheit?: string; einzelpreis: number; mwstSatz: number; kontoId?: string | null }): Promise<Rechnungsposition> {
  const rechnung = await getRechnung(pool, rechnungId);
  if (rechnung.status !== 'offen_prov' && rechnung.status !== 'def_vereinbart') {
    throw new ValidationError(`Positionen nur im Entwurf editierbar (Status ${rechnung.status})`);
  }
  const betragNetto = rappenRunden(p.menge * p.einzelpreis);
  const r = await pool.query(
    `insert into rechnungsposition(rechnung_id,position,beschreibung,menge,einheit,einzelpreis,mwst_satz,konto_id,betrag_netto)
     values ($1,(select coalesce(max(position),0)+1 from rechnungsposition where rechnung_id=$1),$2,$3,coalesce($4,'Pauschal'),$5,$6,$7,$8) returning *`,
    [rechnungId, p.beschreibung, p.menge, p.einheit ?? null, p.einzelpreis, p.mwstSatz, p.kontoId ?? null, betragNetto]);
  await recalcTotale(pool, rechnungId);
  return mapP(r.rows[0]);
}

export async function festschreiben(pool: pg.Pool, rechnungId: string, erstellerKuerzel?: string): Promise<Rechnung> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const rr = await client.query('select * from rechnung where id=$1 for update', [rechnungId]);
    if (!rr.rowCount) throw new NotFoundError(`Rechnung ${rechnungId} nicht gefunden`);
    const rechnung = mapR(rr.rows[0]);
    if (rechnung.status !== 'offen_prov' && rechnung.status !== 'def_vereinbart') {
      throw new ValidationError(`Festschreibung nur aus Entwurf (Status ${rechnung.status})`);
    }
    const pc = await client.query('select count(*)::int as n from rechnungsposition where rechnung_id=$1', [rechnungId]);
    if (pc.rows[0].n === 0) throw new ValidationError('Rechnung ohne Positionen kann nicht festgeschrieben werden');

    // Lueckenloser Zaehler: Sperre haelt bis commit/rollback -> bei Fehler keine Luecke
    const z = await client.query(`update zaehler set wert = wert + 1 where name='rechnung_lfd_nr' returning wert`);
    const lfdNr: number = z.rows[0].wert;

    const projekt = await getProjektById(pool, rechnung.projektId);
    const nummer = `${projekt.nummer} - ${lfdNr}${erstellerKuerzel ? ' ' + erstellerKuerzel : ''}`;

    const upd = await client.query(
      `update rechnung set lfd_nr=$2, nummer=$3, status='abgerechnet', festgeschrieben_am=now() where id=$1 returning *`,
      [rechnungId, lfdNr, nummer]);
    await client.query('commit');
    return mapR(upd.rows[0]);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export async function setDefVereinbart(pool: pg.Pool, id: string): Promise<Rechnung> {
  const r = await getRechnung(pool, id);
  if (r.status !== 'offen_prov') throw new ValidationError(`def_vereinbart nur aus offen_prov (Status ${r.status})`);
  const upd = await pool.query(`update rechnung set status='def_vereinbart' where id=$1 returning *`, [id]);
  return mapR(upd.rows[0]);
}

/**
 * Storno einer festgeschriebenen Rechnung (Spec v1 §6.1): die Rechnung wird storniert und ein **Storno-Beleg**
 * (Gutschrift) mit eigener, lueckenloser Nummer erstellt. Positionen und Totale werden exakt gespiegelt (nicht neu
 * gerundet), damit MWSt-Korrektur und Originalbeleg sich auf den Rappen aufheben. Verrechnete Leistungen
 * (Zeiteintraege, Kurs-Anmeldungen, SAQ-Faelle) werden fuer eine korrigierte Neuverrechnung freigegeben.
 */
export async function stornieren(pool: pg.Pool, id: string, grund?: string, benutzer?: string | null): Promise<Rechnung & { gutschrift: Rechnung }> {
  const r = await getRechnung(pool, id);
  if (r.typ === 'gutschrift') throw new ValidationError('Eine Gutschrift kann nicht storniert werden');
  if (r.status !== 'abgerechnet' && r.status !== 'bezahlt') {
    throw new ValidationError(`Storno nur aus abgerechnet/bezahlt (Status ${r.status})`);
  }
  return inTransaktion(pool, async (c) => {
    const gesperrt = await c.query(`select status from rechnung where id=$1 for update`, [id]);
    if (gesperrt.rows[0].status === 'storniert') throw new ValidationError('Rechnung ist bereits storniert');
    const upd = await c.query(`update rechnung set status='storniert' where id=$1 returning *`, [id]);
    const lfd: number = (await c.query(`update zaehler set wert = wert + 1 where name='rechnung_lfd_nr' returning wert`)).rows[0].wert;
    const projekt = await getProjektById(c, r.projektId);
    const g = await c.query(
      `insert into rechnung(projekt_id,auftraggeber_id,datum,betreff,mwst_modus,waehrung,lfd_nr,nummer,status,total_netto,total_mwst,total_brutto,
         festgeschrieben_am,typ,bezug_rechnung_id)
       values ($1,$2,current_date,$3,$4,$5,$6,$7,'storniert',$8,$9,$10,now(),'gutschrift',$11) returning *`,
      [r.projektId, r.auftraggeberId, `Gutschrift zu Rechnung ${r.nummer}${grund ? ` (${grund})` : ''}`, r.mwstModus, r.waehrung, lfd,
       `${projekt.nummer} - ${lfd} G${benutzer ? ' ' + benutzer : ''}`, -r.totalNetto, -r.totalMwst, -r.totalBrutto, id]);
    await c.query(
      `insert into rechnungsposition(rechnung_id,position,beschreibung,menge,einheit,einzelpreis,mwst_satz,konto_id,betrag_netto)
       select $2, position, beschreibung, menge, einheit, -einzelpreis, mwst_satz, konto_id, -betrag_netto from rechnungsposition where rechnung_id=$1`,
      [id, g.rows[0].id]);
    const z = await c.query(
      `update zeiterfassung set rechnungsposition_id=null
       where rechnungsposition_id in (select id from rechnungsposition where rechnung_id=$1)`, [id]);
    const a = await c.query('update anmeldung set rechnung_id=null where rechnung_id=$1', [id]);
    const f = await c.query('update saq_fall set rechnung_id=null where rechnung_id=$1', [id]);
    const bezahlt = Number((await c.query('select coalesce(sum(betrag),0) as s from zahlungseingang where rechnung_id=$1', [id])).rows[0].s);
    await audit(c, { benutzer, aktion: 'storniert', entitaet: 'rechnung', entitaetId: id,
      details: { grund: grund ?? null, gutschriftId: g.rows[0].id, gutschriftNummer: g.rows[0].nummer, rueckerstattungOffenChf: bezahlt,
        freigegeben: { zeiteintraege: z.rowCount, anmeldungen: a.rowCount, saqFaelle: f.rowCount } } });
    return { ...mapR(upd.rows[0]), gutschrift: mapR(g.rows[0]) };
  });
}
