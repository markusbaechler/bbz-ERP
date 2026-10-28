// Spesen je Projekt und ihre Weiterverrechnung (loest "Spesen Importieren" der FileMaker-Loesung ab).
import type pg from 'pg';
import type { Rechnung, Rechnungsposition } from '../domain/types';
import { pruefeDatum } from '../domain/pmTypes';
import { rappenRunden } from '../domain/mwst';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { type Db, inTransaktion } from './db';
import { getProjektById } from './projektRepo';
import { createRechnung, addPosition, getRechnung } from './rechnungRepo';
import { audit } from './auditRepo';

export const SPESEN_ARTEN = ['km', 'auslage'] as const;
export type SpesenArt = typeof SPESEN_ARTEN[number];
export type Spesen = {
  id: string; projektId: string; einsatzId: string | null; datum: string; art: SpesenArt; beschreibung: string;
  menge: number; ansatzChf: number; betragChf: number; verrechenbar: boolean; rechnungspositionId: string | null;
  erfasstDurch: string | null;
};
export type SpesenInput = {
  projektId: string; datum: string; art: SpesenArt; beschreibung: string; menge?: number; ansatzChf: number;
  verrechenbar?: boolean; einsatzId?: string | null;
};

const mapS = (r: any): Spesen => ({
  id: r.id, projektId: r.projekt_id, einsatzId: r.einsatz_id, datum: r.datum, art: r.art, beschreibung: r.beschreibung,
  menge: Number(r.menge), ansatzChf: Number(r.ansatz_chf), betragChf: rappenRunden(Number(r.menge) * Number(r.ansatz_chf)),
  verrechenbar: r.verrechenbar, rechnungspositionId: r.rechnungsposition_id, erfasstDurch: r.erfasst_durch,
});

export async function createSpesen(db: Db, input: SpesenInput, benutzer: string | null = null): Promise<Spesen> {
  pruefeDatum('datum', input?.datum, true);
  if (!SPESEN_ARTEN.includes(input.art)) throw new ValidationError(`art muss ${SPESEN_ARTEN.join('|')} sein`);
  if (!input.beschreibung?.trim()) throw new ValidationError('beschreibung ist Pflicht');
  if (input.art === 'km' && (input.menge === undefined || input.menge === null)) throw new ValidationError('Kilometer (menge) sind bei einer Fahrt Pflicht');
  const menge = input.menge ?? 1;
  if (!(typeof menge === 'number' && menge > 0)) throw new ValidationError('menge muss > 0 sein');
  if (!(typeof input.ansatzChf === 'number' && input.ansatzChf >= 0)) throw new ValidationError('ansatzChf muss >= 0 sein');
  await getProjektById(db, input.projektId);
  const r = await db.query(
    `insert into spesen(projekt_id,einsatz_id,datum,art,beschreibung,menge,ansatz_chf,verrechenbar,erfasst_durch)
     values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,true),$9) returning *`,
    [input.projektId, input.einsatzId ?? null, input.datum, input.art, input.beschreibung.trim(), menge, input.ansatzChf,
     input.verrechenbar ?? null, benutzer]);
  return mapS(r.rows[0]);
}

export async function listSpesen(db: Db, filter: { projektId: string; offen?: boolean }): Promise<Spesen[]> {
  const r = await db.query(
    `select * from spesen where projekt_id=$1 ${filter.offen ? 'and rechnungsposition_id is null' : ''} order by datum, erstellt_am`, [filter.projektId]);
  return r.rows.map(mapS);
}

export async function deleteSpesen(db: Db, id: string): Promise<void> {
  const r = await db.query('select rechnungsposition_id from spesen where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Spesen ${id} nicht gefunden`);
  if (r.rows[0].rechnungsposition_id) throw new ConflictError('Verrechnete Spesen koennen nicht geloescht werden');
  await db.query('delete from spesen where id=$1', [id]);
}

export type SpesenVerrechnenInput = { datum: string; bis?: string | null; mwstSatz: number; rechnungId?: string | null; betreff?: string | null };

const datumCh = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Verrechnet die offenen, verrechenbaren Spesen des Projekts (optional bis Stichtag) in EINER Transaktion: je Spesen eine
 * Position (km: Menge x CHF/km, Auslage: Pauschal) auf einen neuen Entwurf beim Auftraggeber oder einen bestehenden
 * Entwurf desselben Projekts (z. B. nach zeit-verrechnen). Konto = Ertragskonto des Projekts.
 */
export async function spesenVerrechnen(pool: pg.Pool, projektId: string, input: SpesenVerrechnenInput, benutzer: string | null = null): Promise<{ rechnung: Rechnung; positionen: Rechnungsposition[] }> {
  pruefeDatum('datum', input?.datum, true);
  pruefeDatum('bis', input.bis);
  if (typeof input.mwstSatz !== 'number' || !(input.mwstSatz >= 0 && input.mwstSatz < 100)) throw new ValidationError('mwstSatz muss eine Zahl 0..100 sein');
  return inTransaktion(pool, async (c) => {
    const projekt = await getProjektById(c, projektId);
    const offen = (await c.query(
      `select * from spesen where projekt_id=$1 and verrechenbar and rechnungsposition_id is null and ($2::date is null or datum <= $2::date)
       order by datum, erstellt_am for update`, [projektId, input.bis ?? null])).rows.map(mapS);
    if (!offen.length) throw new ValidationError('Keine verrechenbaren Spesen vorhanden');
    let rechnungId: string;
    if (input.rechnungId) {
      const rr = await c.query('select projekt_id, status from rechnung where id=$1 for update', [input.rechnungId]);
      if (!rr.rowCount) throw new NotFoundError(`Rechnung ${input.rechnungId} nicht gefunden`);
      if (rr.rows[0].projekt_id !== projektId) throw new ValidationError('Rechnung gehoert nicht zum Projekt');
      if (!['offen_prov', 'def_vereinbart'].includes(rr.rows[0].status)) throw new ValidationError(`Rechnung ist kein Entwurf (Status ${rr.rows[0].status})`);
      rechnungId = input.rechnungId;
    } else {
      rechnungId = (await createRechnung(c, { projektId, auftraggeberId: projekt.auftraggeberId, datum: input.datum,
        mwstModus: projekt.mwstModus, betreff: input.betreff ?? `Spesen: ${projekt.name}` })).id;
    }
    const positionen: Rechnungsposition[] = [];
    for (const s of offen) {
      const pos = await addPosition(c, rechnungId, {
        beschreibung: `Spesen ${datumCh(s.datum)}: ${s.beschreibung}`, menge: s.art === 'km' ? s.menge : 1,
        einheit: s.art === 'km' ? 'km' : 'Pauschal', einzelpreis: s.art === 'km' ? s.ansatzChf : s.betragChf,
        mwstSatz: input.mwstSatz, kontoId: projekt.ertragskontoId,
      });
      await c.query('update spesen set rechnungsposition_id=$1 where id=$2', [pos.id, s.id]);
      positionen.push(pos);
    }
    await audit(c, { benutzer, aktion: 'spesen_verrechnet', entitaet: 'projekt', entitaetId: projektId,
      details: { rechnungId, anzahl: offen.length, summeChf: rappenRunden(offen.reduce((x, s) => x + s.betragChf, 0)) } });
    return { rechnung: await getRechnung(c, rechnungId), positionen };
  });
}
