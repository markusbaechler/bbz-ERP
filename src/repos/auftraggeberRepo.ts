import type pg from 'pg';
import type { Auftraggeber } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';

const map = (r: any): Auftraggeber => ({
  id: r.id, nummer: r.nummer, name: r.name, strasse: r.strasse, plz: r.plz, ort: r.ort,
  land: r.land, ansprechperson: r.ansprechperson, email: r.email, telefon: r.telefon, aktiv: r.aktiv,
  zusatz: r.zusatz, adresseUnvollstaendig: r.adresse_unvollstaendig,
});

export async function createAuftraggeber(pool: pg.Pool, input: {
  nummer?: string | null; name: string; strasse: string; plz: string; ort: string;
  land?: string; ansprechperson?: string | null; email?: string | null; telefon?: string | null;
}): Promise<Auftraggeber> {
  for (const f of ['name', 'strasse', 'plz', 'ort'] as const) {
    if (!input[f] || !String(input[f]).trim()) throw new ValidationError(`Feld ${f} ist Pflicht`);
  }
  const r = await pool.query(
    `insert into auftraggeber(nummer,name,strasse,plz,ort,land,ansprechperson,email,telefon)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [input.nummer ?? null, input.name, input.strasse, input.plz, input.ort, input.land ?? 'CH',
     input.ansprechperson ?? null, input.email ?? null, input.telefon ?? null]);
  return map(r.rows[0]);
}

export type AuftraggeberUpdate = {
  name?: string; strasse?: string; plz?: string; ort?: string; land?: string;
  zusatz?: string | null; ansprechperson?: string | null; email?: string | null; telefon?: string | null;
};

const UPDATE_SPALTE: Record<keyof AuftraggeberUpdate, string> = {
  name: 'name', strasse: 'strasse', plz: 'plz', ort: 'ort', land: 'land',
  zusatz: 'zusatz', ansprechperson: 'ansprechperson', email: 'email', telefon: 'telefon',
};
// Dieselbe Pflichtfeld-Regel wie in createAuftraggeber — hier auf die uebergebenen Felder
// angewendet: wer ein Pflichtfeld mitschickt, muss es fuellen. Ein Leerwert wird
// zurueckgewiesen statt geschrieben; sonst liesse sich eine vorhandene Adresse loeschen,
// waehrend adresse_unvollstaendig auf false stehen bleibt.
const UPDATE_PFLICHT = ['name', 'strasse', 'plz', 'ort', 'land'] as const;

// Der einzige Weg, eine aus der Migration stammende Adresse nachzutragen (Befund B3).
// adresse_unvollstaendig ist bewusst kein Eingabefeld, sondern wird aus den Daten
// abgeleitet: erst wenn Strasse, PLZ und Ort alle gefuellt sind, faellt das Kennzeichen
// auf false und die Festschreibung (rechnungRepo.festschreiben) gibt den Auftraggeber frei.
// Anders herum wird es hier nie gesetzt — ein Leerwert kommt oben gar nicht durch.
export async function updateAuftraggeber(pool: pg.Pool, id: string, input: AuftraggeberUpdate): Promise<Auftraggeber> {
  const felder = (Object.keys(UPDATE_SPALTE) as Array<keyof AuftraggeberUpdate>)
    .filter((f) => input[f] !== undefined);
  if (felder.length === 0) throw new ValidationError('Kein aenderbares Feld uebergeben');
  for (const f of felder) {
    if ((UPDATE_PFLICHT as readonly string[]).includes(f) && !String(input[f] ?? '').trim()) {
      throw new ValidationError(`Feld ${f} ist Pflicht`);
    }
  }

  const args: any[] = [id];
  const sets: string[] = [];
  // Fuer die Ableitung des Kennzeichens zaehlt der Wert *nach* dem Update: fuer ein
  // mitgeschicktes Feld also der Platzhalter, sonst die bisherige Spalte.
  const nachher: Record<'strasse' | 'plz' | 'ort', string> = { strasse: 'strasse', plz: 'plz', ort: 'ort' };
  for (const f of felder) {
    args.push(input[f] ?? null);
    const ph = `$${args.length}`;
    sets.push(`${UPDATE_SPALTE[f]}=${ph}`);
    if (f === 'strasse' || f === 'plz' || f === 'ort') nachher[f] = ph;
  }
  sets.push(
    `adresse_unvollstaendig = case when btrim(${nachher.strasse}::text) <> ''
                                   and btrim(${nachher.plz}::text) <> ''
                                   and btrim(${nachher.ort}::text) <> ''
                              then false else adresse_unvollstaendig end`);

  const r = await pool.query(`update auftraggeber set ${sets.join(', ')} where id=$1 returning *`, args);
  if (!r.rowCount) throw new NotFoundError(`Auftraggeber ${id} nicht gefunden`);
  return map(r.rows[0]);
}

// Nimmt Pool oder Client: die Festschreibung muss den Auftraggeber innerhalb ihrer
// eigenen Transaktion lesen (siehe rechnungRepo.festschreiben).
export async function getAuftraggeberById(pool: pg.Pool | pg.PoolClient, id: string): Promise<Auftraggeber> {
  const r = await pool.query('select * from auftraggeber where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Auftraggeber ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function listAuftraggeber(pool: pg.Pool): Promise<Auftraggeber[]> {
  const r = await pool.query('select * from auftraggeber order by name');
  return r.rows.map(map);
}

export async function findAuftraggeberByNummer(pool: pg.Pool, nummer: string): Promise<Auftraggeber | null> {
  const r = await pool.query('select * from auftraggeber where nummer=$1', [nummer]);
  return r.rowCount ? map(r.rows[0]) : null;
}

// Import ohne Adresse: der FileMaker-Projektexport enthaelt keine Adressfelder (Befund B3).
// Bereits erfasste Adressen werden nie ueberschrieben.
export async function upsertAuftraggeberAusMigration(pool: pg.Pool, input: {
  nummer: string; name: string; zusatz?: string | null; ansprechperson?: string | null;
}): Promise<{ auftraggeber: Auftraggeber; neu: boolean }> {
  if (!input.nummer?.trim()) throw new ValidationError('nummer ist Pflicht');
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  const r = await pool.query(
    `insert into auftraggeber(nummer,name,zusatz,strasse,plz,ort,ansprechperson,adresse_unvollstaendig)
     values ($1,$2,$3,'','','',$4,true)
     on conflict (nummer) do update set
       name=excluded.name,
       zusatz=coalesce(excluded.zusatz, auftraggeber.zusatz),
       ansprechperson=coalesce(excluded.ansprechperson, auftraggeber.ansprechperson)
     returning *, (xmax = 0) as neu`,
    [input.nummer, input.name, input.zusatz ?? null, input.ansprechperson ?? null]);
  return { auftraggeber: map(r.rows[0]), neu: r.rows[0].neu };
}
