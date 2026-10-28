import type pg from 'pg';
import type { Rechnung, Rechnungsposition } from '../domain/types';
import type { Zeiterfassung, ZeitGruppierung } from '../domain/pmTypes';
import { ZEIT_GRUPPIERUNG, pruefeDatum } from '../domain/pmTypes';
import { gruppiereZeit, type ZeitEintragRoh } from '../domain/zeitVerrechnung';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { type Db, inTransaktion, patchSets, num } from './db';
import { getProjektById } from './projektRepo';
import { createRechnung, addPosition, getRechnung } from './rechnungRepo';
import { audit } from './auditRepo';

const map = (r: any): Zeiterfassung => ({
  id: r.id, mitarbeitendeId: r.mitarbeitende_id, projektId: r.projekt_id, aufgabeId: r.aufgabe_id, datum: r.datum,
  stunden: Number(r.stunden), taetigkeit: r.taetigkeit, verrechenbar: r.verrechenbar, ansatzChf: num(r.ansatz_chf),
  rechnungspositionId: r.rechnungsposition_id, verrechnet: r.rechnungsposition_id !== null,
});

export type ZeiterfassungInput = {
  mitarbeitendeId: string; projektId: string; aufgabeId?: string | null; datum: string; stunden: number;
  taetigkeit: string; verrechenbar?: boolean; ansatzChf?: number | null;
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function pruefeFelder(input: Partial<ZeiterfassungInput>, neu: boolean): void {
  if (neu && !input.mitarbeitendeId) throw new ValidationError('mitarbeitendeId ist Pflicht');
  if (neu && !input.projektId) throw new ValidationError('projektId ist Pflicht');
  if (!neu && has(input, 'mitarbeitendeId') && !input.mitarbeitendeId) throw new ValidationError('mitarbeitendeId ist Pflicht');
  if (!neu && has(input, 'projektId') && !input.projektId) throw new ValidationError('projektId ist Pflicht');
  if (neu || has(input, 'datum')) pruefeDatum('datum', input.datum, true);
  if (neu || has(input, 'stunden')) {
    const h = input.stunden;
    if (typeof h !== 'number' || !(h > 0 && h <= 24)) throw new ValidationError('stunden muss > 0 und <= 24 sein');
  }
  if ((neu || has(input, 'taetigkeit')) && !input.taetigkeit?.trim()) throw new ValidationError('taetigkeit ist Pflicht');
  if (input.verrechenbar !== undefined && typeof input.verrechenbar !== 'boolean') throw new ValidationError('verrechenbar muss boolean sein');
  if (input.ansatzChf !== undefined && input.ansatzChf !== null && !(typeof input.ansatzChf === 'number' && input.ansatzChf >= 0)) {
    throw new ValidationError('ansatzChf muss >= 0 sein');
  }
}

async function pruefeAufgabe(db: Db, aufgabeId: string | null | undefined, projektId: string): Promise<void> {
  if (!aufgabeId) return;
  const r = await db.query('select projekt_id from aufgabe where id=$1', [aufgabeId]);
  if (!r.rowCount || r.rows[0].projekt_id !== projektId) throw new ValidationError('Aufgabe gehoert nicht zum Projekt');
}

/** Erfasst Zeit. Ansatz-Default = Verrechnungssatz der Person (Spec §5.3); explizites null = ohne Ansatz. */
export async function createZeiterfassung(db: Db, input: ZeiterfassungInput): Promise<Zeiterfassung> {
  pruefeFelder(input, true);
  const ma = await db.query('select stundensatz_verrechnung from mitarbeitende where id=$1', [input.mitarbeitendeId]);
  if (!ma.rowCount) throw new NotFoundError('Mitarbeitende nicht gefunden');
  await getProjektById(db, input.projektId);
  await pruefeAufgabe(db, input.aufgabeId, input.projektId);
  const ansatz = input.ansatzChf !== undefined ? input.ansatzChf : num(ma.rows[0].stundensatz_verrechnung);
  const r = await db.query(
    `insert into zeiterfassung(mitarbeitende_id,projekt_id,aufgabe_id,datum,stunden,taetigkeit,verrechenbar,ansatz_chf)
     values ($1,$2,$3,$4,$5,$6,coalesce($7,true),$8) returning *`,
    [input.mitarbeitendeId, input.projektId, input.aufgabeId ?? null, input.datum, input.stunden, input.taetigkeit.trim(),
     input.verrechenbar ?? null, ansatz]);
  return map(r.rows[0]);
}

export async function getZeiterfassung(db: Db, id: string): Promise<Zeiterfassung> {
  const r = await db.query('select * from zeiterfassung where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Zeiteintrag ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export type ZeiterfassungFilter = {
  projektId?: string; mitarbeitendeId?: string; von?: string; bis?: string; verrechnet?: boolean; verrechenbar?: boolean;
};

export async function listZeiterfassung(db: Db, filter: ZeiterfassungFilter = {}): Promise<Zeiterfassung[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  pruefeDatum('von', filter.von);
  pruefeDatum('bis', filter.bis);
  if (filter.projektId) add('projekt_id=?', filter.projektId);
  if (filter.mitarbeitendeId) add('mitarbeitende_id=?', filter.mitarbeitendeId);
  if (filter.von) add('datum>=?', filter.von);
  if (filter.bis) add('datum<=?', filter.bis);
  if (filter.verrechnet !== undefined) cond.push(filter.verrechnet ? 'rechnungsposition_id is not null' : 'rechnungsposition_id is null');
  if (filter.verrechenbar !== undefined) add('verrechenbar=?', filter.verrechenbar);
  const r = await db.query(
    `select * from zeiterfassung ${cond.length ? 'where ' + cond.join(' and ') : ''} order by datum, erstellt_am`, args);
  return r.rows.map(map);
}

const gesperrt = (id: string) => new ConflictError(`Zeiteintrag ${id} ist verrechnet und gesperrt`);

export async function updateZeiterfassung(db: Db, id: string, patch: Partial<ZeiterfassungInput>): Promise<Zeiterfassung> {
  pruefeFelder(patch, false);
  const alt = await getZeiterfassung(db, id);
  if (alt.verrechnet) throw gesperrt(id);
  const projektId = patch.projektId ?? alt.projektId;
  if (has(patch, 'projektId')) await getProjektById(db, projektId);
  if (has(patch, 'mitarbeitendeId')) {
    const ma = await db.query('select 1 from mitarbeitende where id=$1', [patch.mitarbeitendeId]);
    if (!ma.rowCount) throw new NotFoundError('Mitarbeitende nicht gefunden');
  }
  if (has(patch, 'aufgabeId') || has(patch, 'projektId')) await pruefeAufgabe(db, has(patch, 'aufgabeId') ? patch.aufgabeId : alt.aufgabeId, projektId);
  const p: Record<string, unknown> = { ...patch };
  if (has(patch, 'taetigkeit')) p.taetigkeit = patch.taetigkeit!.trim();
  const args: unknown[] = [id];
  const sets = patchSets(p, {
    mitarbeitendeId: 'mitarbeitende_id', projektId: 'projekt_id', aufgabeId: 'aufgabe_id', datum: 'datum', stunden: 'stunden',
    taetigkeit: 'taetigkeit', verrechenbar: 'verrechenbar', ansatzChf: 'ansatz_chf',
  }, args);
  if (!sets.length) return alt;
  // Sperre auch gegen parallele Verrechnung absichern
  const r = await db.query(`update zeiterfassung set ${sets.join(',')} where id=$1 and rechnungsposition_id is null returning *`, args);
  if (!r.rowCount) throw gesperrt(id);
  return map(r.rows[0]);
}

export async function deleteZeiterfassung(db: Db, id: string): Promise<void> {
  const r = await db.query('delete from zeiterfassung where id=$1 and rechnungsposition_id is null', [id]);
  if (r.rowCount) return;
  await getZeiterfassung(db, id);   // 404, falls es ihn nicht gibt
  throw gesperrt(id);
}

export type ZeitVerrechnenInput = {
  datum: string; bis?: string | null; mwstSatz: number; gruppierung: ZeitGruppierung; rechnungId?: string | null; betreff?: string | null;
};
export type ZeitVerrechnenErgebnis = { rechnung: Rechnung; positionen: Rechnungsposition[]; anzahlEintraege: number };

/**
 * Zeit -> Rechnung (Spec §5.3) in EINER Transaktion: verrechenbare, unverrechnete Eintraege des Projekts
 * (optional bis Stichtag) werden gesperrt, zu Positionen (Std x Ansatz) gruppiert, auf einen neuen
 * Rechnungsentwurf beim Auftraggeber des Projekts (oder einen bestehenden Entwurf desselben Projekts)
 * gebucht und mit ihrer Position verknuepft. Konto = Ertragskonto des Projekts. Bei jedem Fehler: Rollback.
 */
export async function zeitVerrechnen(pool: pg.Pool, projektId: string, input: ZeitVerrechnenInput,
  opts: { benutzer?: string | null } = {}): Promise<ZeitVerrechnenErgebnis> {
  pruefeDatum('datum', input.datum, true);
  pruefeDatum('bis', input.bis);
  if (!ZEIT_GRUPPIERUNG.includes(input.gruppierung)) throw new ValidationError(`gruppierung muss ${ZEIT_GRUPPIERUNG.join('|')} sein`);
  if (typeof input.mwstSatz !== 'number' || !(input.mwstSatz >= 0 && input.mwstSatz < 100)) throw new ValidationError('mwstSatz muss eine Zahl 0..100 sein');

  return inTransaktion(pool, async (c) => {
    const projekt = await getProjektById(c, projektId);
    const ez = await c.query(
      `select z.*, m.kuerzel from zeiterfassung z join mitarbeitende m on m.id = z.mitarbeitende_id
       where z.projekt_id=$1 and z.verrechenbar and z.rechnungsposition_id is null and ($2::date is null or z.datum <= $2::date)
       order by z.datum, z.erstellt_am
       for update of z`, [projektId, input.bis ?? null]);
    if (!ez.rowCount) throw new ValidationError('Keine verrechenbaren, unverrechneten Zeiteintraege vorhanden');
    const eintraege: ZeitEintragRoh[] = ez.rows.map((r: any) => ({
      id: r.id, mitarbeitendeId: r.mitarbeitende_id, kuerzel: r.kuerzel, datum: r.datum,
      stunden: Number(r.stunden), taetigkeit: r.taetigkeit, ansatzChf: num(r.ansatz_chf),
    }));
    const gruppen = gruppiereZeit(eintraege, input.gruppierung);   // 400 bei fehlendem Ansatz

    let rechnungId: string;
    if (input.rechnungId) {
      const rr = await c.query('select projekt_id, status from rechnung where id=$1 for update', [input.rechnungId]);
      if (!rr.rowCount) throw new NotFoundError(`Rechnung ${input.rechnungId} nicht gefunden`);
      if (rr.rows[0].projekt_id !== projektId) throw new ValidationError('Rechnung gehoert nicht zum Projekt');
      if (!['offen_prov', 'def_vereinbart'].includes(rr.rows[0].status)) {
        throw new ValidationError(`Rechnung ist kein Entwurf (Status ${rr.rows[0].status})`);
      }
      rechnungId = input.rechnungId;
    } else {
      rechnungId = (await createRechnung(c, {
        projektId, auftraggeberId: projekt.auftraggeberId, datum: input.datum, mwstModus: projekt.mwstModus,
        betreff: input.betreff ?? `Leistungen nach Aufwand: ${projekt.name}`,
      })).id;
    }

    const positionen: Rechnungsposition[] = [];
    for (const g of gruppen) {
      const pos = await addPosition(c, rechnungId, {
        beschreibung: g.beschreibung, menge: g.menge, einheit: 'Std', einzelpreis: g.einzelpreis,
        mwstSatz: input.mwstSatz, kontoId: projekt.ertragskontoId,
      });
      await c.query('update zeiterfassung set rechnungsposition_id=$1 where id = any($2::uuid[])', [pos.id, g.eintragIds]);
      positionen.push(pos);
    }
    const stunden = Math.round(eintraege.reduce((s, e) => s + e.stunden, 0) * 100) / 100;
    await audit(c, {
      benutzer: opts.benutzer, aktion: 'zeit_verrechnet', entitaet: 'projekt', entitaetId: projektId,
      details: { rechnungId, anzahlEintraege: eintraege.length, stunden, gruppierung: input.gruppierung, bis: input.bis ?? null },
    });
    return { rechnung: await getRechnung(c, rechnungId), positionen, anzahlEintraege: eintraege.length };
  });
}
