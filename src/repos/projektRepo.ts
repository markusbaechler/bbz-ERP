import type pg from 'pg';
import type { Projekt, MigrationProjektInput } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';

const map = (r: any): Projekt => ({
  id: r.id, nummer: r.nummer, stammnummer: r.stammnummer, jahr: r.jahr,
  kuerzel: r.kuerzel, name: r.name, bereich: r.bereich,
  auftraggeberId: r.auftraggeber_id, ertragskontoId: r.ertragskonto_id,
  budgetChf: r.budget_chf === null ? null : Number(r.budget_chf),
  budgetTage: r.budget_tage === null ? null : Number(r.budget_tage),
  mwstModus: r.mwst_modus, fortsetzungVonId: r.fortsetzung_von_id,
});

export async function createProjekt(pool: pg.Pool, input: {
  stammnummer: number; jahr: number; name: string; auftraggeberId: string;
  ertragskontoId?: string | null; kuerzel?: string | null; bereich?: string | null;
  budgetChf?: number | null; budgetTage?: number | null; mwstModus?: 'exkl' | 'inkl'; fortsetzungVonId?: string | null;
}): Promise<Projekt> {
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  if (!input.auftraggeberId) throw new ValidationError('auftraggeberId ist Pflicht');
  const nummer = `${input.stammnummer}.${String(input.jahr).slice(-2)}`;
  const r = await pool.query(
    `insert into projekt(nummer,stammnummer,jahr,name,auftraggeber_id,ertragskonto_id,kuerzel,bereich,budget_chf,budget_tage,mwst_modus,fortsetzung_von_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'exkl'),$12) returning *`,
    [nummer, input.stammnummer, input.jahr, input.name, input.auftraggeberId,
     input.ertragskontoId ?? null, input.kuerzel ?? null, input.bereich ?? null,
     input.budgetChf ?? null, input.budgetTage ?? null, input.mwstModus ?? null, input.fortsetzungVonId ?? null]);
  return map(r.rows[0]);
}

export async function getProjektById(pool: pg.Pool, id: string): Promise<Projekt> {
  const r = await pool.query('select * from projekt where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Projekt ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function listProjekte(pool: pg.Pool, filter: { jahr?: number; auftraggeberId?: string } = {}): Promise<Projekt[]> {
  const cond: string[] = []; const args: any[] = [];
  if (filter.jahr !== undefined) { args.push(filter.jahr); cond.push(`jahr=$${args.length}`); }
  if (filter.auftraggeberId) { args.push(filter.auftraggeberId); cond.push(`auftraggeber_id=$${args.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  const r = await pool.query(`select * from projekt ${where} order by nummer`, args);
  return r.rows.map(map);
}

export async function getJahresverlauf(pool: pg.Pool, stammnummer: number): Promise<Projekt[]> {
  const r = await pool.query('select * from projekt where stammnummer=$1 order by jahr asc', [stammnummer]);
  return r.rows.map(map);
}

export async function upsertProjektAusMigration(pool: pg.Pool, input: MigrationProjektInput): Promise<{ projekt: Projekt; neu: boolean }> {
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  if (!input.auftraggeberId) throw new ValidationError('auftraggeberId ist Pflicht');
  const nummer = `${input.stammnummer}.${String(input.jahr).slice(-2)}`;
  const r = await pool.query(
    `insert into projekt(nummer,stammnummer,jahr,name,auftraggeber_id,ertragskonto_id,aufwand_konto_id,
                         kuerzel,bereich,beschrieb,ansprechperson,budget_chf,budget_tage,aufwand_budget_chf,
                         fm_offen_prov,fm_abgerechnet,alte_projekt_nr,projektleitung_kuerzel,mwst_modus,
                         erstellt_durch,geaendert_durch)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     on conflict (stammnummer, jahr) do update set
       name=excluded.name, auftraggeber_id=excluded.auftraggeber_id,
       ertragskonto_id=excluded.ertragskonto_id, aufwand_konto_id=excluded.aufwand_konto_id,
       kuerzel=excluded.kuerzel, bereich=excluded.bereich, beschrieb=excluded.beschrieb,
       ansprechperson=excluded.ansprechperson, budget_chf=excluded.budget_chf,
       budget_tage=excluded.budget_tage, aufwand_budget_chf=excluded.aufwand_budget_chf,
       fm_offen_prov=excluded.fm_offen_prov, fm_abgerechnet=excluded.fm_abgerechnet,
       alte_projekt_nr=excluded.alte_projekt_nr, projektleitung_kuerzel=excluded.projektleitung_kuerzel,
       mwst_modus=excluded.mwst_modus, geaendert_durch=excluded.geaendert_durch, geaendert_am=now()
     returning *, (xmax = 0) as neu`,
    [nummer, input.stammnummer, input.jahr, input.name, input.auftraggeberId,
     input.ertragskontoId, input.aufwandKontoId, input.kuerzel, input.bereich, input.beschrieb,
     input.ansprechperson, input.budgetChf, input.budgetTage, input.aufwandBudgetChf,
     input.fmOffenProv, input.fmAbgerechnet, input.alteProjektNr, input.projektleitungKuerzel,
     input.mwstModus, input.erstelltDurch, input.geaendertDurch]);
  return { projekt: map(r.rows[0]), neu: r.rows[0].neu };
}

export async function projektSummen(pool: pg.Pool, jahr: number): Promise<{ anzahl: number; budgetChf: number; offenProv: number; abgerechnet: number }> {
  const r = await pool.query(
    `select count(*)::int as anzahl,
            coalesce(sum(budget_chf),0)::numeric   as budget_chf,
            coalesce(sum(fm_offen_prov),0)::numeric as offen_prov,
            coalesce(sum(fm_abgerechnet),0)::numeric as abgerechnet
     from projekt where jahr=$1`, [jahr]);
  const row = r.rows[0];
  return { anzahl: row.anzahl, budgetChf: Number(row.budget_chf), offenProv: Number(row.offen_prov), abgerechnet: Number(row.abgerechnet) };
}
