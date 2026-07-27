import type pg from 'pg';
import type { Rechnung, Rechnungsposition } from '../domain/types';
import { berechneMwst, rappenRunden } from '../domain/mwst';
import { ValidationError, NotFoundError } from '../domain/errors';
import { getProjektById } from './projektRepo';
import { getAuftraggeberById } from './auftraggeberRepo';
import { zaehlerGesperrt, zaehlerSperrText } from '../config/rechnungszaehler';

const mapR = (r: any): Rechnung => ({
  id: r.id, projektId: r.projekt_id, auftraggeberId: r.auftraggeber_id, datum: r.datum,
  betreff: r.betreff, mwstModus: r.mwst_modus, waehrung: r.waehrung,
  lfdNr: r.lfd_nr === null ? null : Number(r.lfd_nr), nummer: r.nummer, status: r.status,
  totalNetto: Number(r.total_netto), totalMwst: Number(r.total_mwst), totalBrutto: Number(r.total_brutto),
});

const mapP = (r: any): Rechnungsposition => ({
  id: r.id, rechnungId: r.rechnung_id, position: r.position, beschreibung: r.beschreibung,
  menge: Number(r.menge), einheit: r.einheit, einzelpreis: Number(r.einzelpreis),
  mwstSatz: Number(r.mwst_satz), kontoId: r.konto_id, betragNetto: Number(r.betrag_netto),
});

export async function createRechnung(pool: pg.Pool, input: { projektId: string; auftraggeberId: string; datum: string; betreff?: string | null; mwstModus?: 'exkl' | 'inkl'; waehrung?: string }): Promise<Rechnung> {
  const r = await pool.query(
    `insert into rechnung(projekt_id,auftraggeber_id,datum,betreff,mwst_modus,waehrung)
     values ($1,$2,$3,$4,coalesce($5,'exkl'),coalesce($6,'CHF')) returning *`,
    [input.projektId, input.auftraggeberId, input.datum, input.betreff ?? null, input.mwstModus ?? null, input.waehrung ?? null]);
  return mapR(r.rows[0]);
}

export async function getRechnung(pool: pg.Pool, id: string): Promise<Rechnung> {
  const r = await pool.query('select * from rechnung where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Rechnung ${id} nicht gefunden`);
  return mapR(r.rows[0]);
}

export async function listPositionen(pool: pg.Pool, rechnungId: string): Promise<Rechnungsposition[]> {
  const r = await pool.query('select * from rechnungsposition where rechnung_id=$1 order by position', [rechnungId]);
  return r.rows.map(mapP);
}

export async function recalcTotale(pool: pg.Pool, rechnungId: string): Promise<Rechnung> {
  const rechnung = await getRechnung(pool, rechnungId);
  const pos = await listPositionen(pool, rechnungId);
  const e = berechneMwst(pos.map((p) => ({ betrag: p.betragNetto, satz: p.mwstSatz })), rechnung.mwstModus);
  const upd = await pool.query(
    'update rechnung set total_netto=$2,total_mwst=$3,total_brutto=$4 where id=$1 returning *',
    [rechnungId, e.totalNetto, e.totalSteuer, e.totalBrutto]);
  return mapR(upd.rows[0]);
}

export async function addPosition(pool: pg.Pool, rechnungId: string, p: { beschreibung: string; menge: number; einheit?: string; einzelpreis: number; mwstSatz: number; kontoId?: string | null }): Promise<Rechnungsposition> {
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

    // Vor dem Zaehler: aus der Migration stammende Auftraggeber haben keine Adresse
    // (adresse_unvollstaendig, Befund B3). Die Rechnungsnummer ist nach Spec §6.1
    // unwiderruflich vergeben — sie darf nicht fuer einen Beleg verbraucht werden,
    // der mangels Debitor-Adresse gar nicht zustellbar ist (kein QR-Zahlteil moeglich).
    const auftraggeber = await getAuftraggeberById(client, rechnung.auftraggeberId);
    if (auftraggeber.adresseUnvollstaendig) {
      throw new ValidationError(
        `Auftraggeber ${auftraggeber.nummer ?? auftraggeber.id} "${auftraggeber.name}" hat keine vollstaendige Adresse ` +
        `(Strasse/PLZ/Ort fehlen aus der FileMaker-Migration). Adresse zuerst ergaenzen: ` +
        `PUT /auftraggeber/${auftraggeber.id} mit strasse, plz und ort — danach ist die Festschreibung moeglich. ` +
        `Sonst verbraucht sie eine unwiderrufliche Rechnungsnummer fuer einen nicht zustellbaren Beleg.`);
    }

    // Lueckenloser Zaehler: Sperre haelt bis commit/rollback -> bei Fehler keine Luecke.
    // Zuerst lesen und pruefen, dann erst erhoehen — genau wie bei der Adress-Pruefung
    // darf keine Nummer verbraucht sein, wenn wir abbrechen. Der Zaehler startet nach
    // der Migration bei 0; steht er nicht ueber der Untergrenze, ist er noch nicht auf
    // den FileMaker-Stand gesetzt und die naechste Nummer waere eine Dublette.
    const zs = await client.query(`select wert from zaehler where name='rechnung_lfd_nr' for update`);
    if (!zs.rowCount) throw new NotFoundError('Zaehler rechnung_lfd_nr nicht gefunden');
    const stand = Number(zs.rows[0].wert);
    if (zaehlerGesperrt(stand)) throw new ValidationError(zaehlerSperrText(stand));

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

export async function stornieren(pool: pg.Pool, id: string, _grund?: string): Promise<Rechnung> {
  const r = await getRechnung(pool, id);
  if (r.status !== 'abgerechnet' && r.status !== 'bezahlt') {
    throw new ValidationError(`Storno nur aus abgerechnet/bezahlt (Status ${r.status})`);
  }
  const upd = await pool.query(`update rechnung set status='storniert' where id=$1 returning *`, [id]);
  return mapR(upd.rows[0]);
}
