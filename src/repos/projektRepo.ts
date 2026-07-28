import type pg from 'pg';
import type { Projekt, MigrationProjektInput, ProjektListenZeile, ProjektDetail, RechnungListenZeile } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';

const zahl = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

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

export type ProjektSchluessel = { stammnummer: number; jahr: number };
/** Betraege sind null, wenn es nichts zu summieren gab — nicht 0. */
export type ProjektSummen = { anzahl: number; budgetChf: number | null; offenProv: number | null; abgerechnet: number | null };

// Summen ueber genau die uebergebenen Projekte. Der Migrations-Abgleich darf weder
// Projekte mitzaehlen, die nicht aus diesem Export stammen (z.B. per REST erfasste),
// noch Jahrgaenge auslassen, wenn eine Datei mehrere enthaelt.
export async function projektSummenFuerSchluessel(pool: pg.Pool, schluessel: ProjektSchluessel[]): Promise<ProjektSummen> {
  // Leere Schluesselliste heisst "nichts uebernommen". Mit 0/0/0 haette der Abgleich
  // einen erfolgreichen Vergleich von nichts behauptet ("0.00 | 0.00 | 0.00 | ok");
  // null wird im Report als "—" gerendert und sagt die Wahrheit.
  if (schluessel.length === 0) return { anzahl: 0, budgetChf: null, offenProv: null, abgerechnet: null };
  // Ohne Dubletten: zwei Export-Zeilen mit derselben Projekt_Nr. liefern denselben
  // Schluessel zweimal, das join unnest(...) traefe dieselbe Zeile zweimal und
  // verdoppelte Summe *und* anzahl. Die CSV-Seite zaehlt beide Zeilen — die Differenz
  // ist genau die Abweichung, die der Abgleich zeigen soll.
  const eindeutig = [...new Map(schluessel.map((s) => [`${s.stammnummer}.${s.jahr}`, s])).values()];
  const r = await pool.query(
    `select count(*)::int as anzahl,
            coalesce(sum(p.budget_chf),0)::numeric      as budget_chf,
            coalesce(sum(p.fm_offen_prov),0)::numeric   as offen_prov,
            coalesce(sum(p.fm_abgerechnet),0)::numeric  as abgerechnet
     from projekt p
     join unnest($1::int[], $2::int[]) as k(stammnummer, jahr)
       on p.stammnummer = k.stammnummer and p.jahr = k.jahr`,
    [eindeutig.map((s) => s.stammnummer), eindeutig.map((s) => s.jahr)]);
  const row = r.rows[0];
  return { anzahl: row.anzahl, budgetChf: Number(row.budget_chf), offenProv: Number(row.offen_prov), abgerechnet: Number(row.abgerechnet) };
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

export async function listProjekteMitAuftraggeber(
  pool: pg.Pool, filter: { jahr?: number } = {},
): Promise<ProjektListenZeile[]> {
  const args: any[] = [];
  let where = '';
  if (filter.jahr !== undefined) { args.push(filter.jahr); where = `where p.jahr=$${args.length}`; }
  const r = await pool.query(
    `select p.id, p.nummer, p.jahr, p.name, p.bereich, p.auftraggeber_id, a.name as auftraggeber_name,
            p.budget_chf, p.fm_abgerechnet, p.fm_offen_prov
     from projekt p join auftraggeber a on a.id = p.auftraggeber_id
     ${where} order by p.nummer`, args);
  return r.rows.map((x) => ({
    id: x.id, nummer: x.nummer, jahr: x.jahr, name: x.name, bereich: x.bereich,
    auftraggeberId: x.auftraggeber_id, auftraggeberName: x.auftraggeber_name,
    budgetChf: zahl(x.budget_chf), fmAbgerechnet: zahl(x.fm_abgerechnet), fmOffenProv: zahl(x.fm_offen_prov),
  }));
}

export async function getProjektDetail(pool: pg.Pool, id: string): Promise<ProjektDetail> {
  const r = await pool.query(
    `select p.*, a.name as auftraggeber_name, a.zusatz as auftraggeber_zusatz,
            a.strasse, a.plz, a.ort, a.land, a.adresse_unvollstaendig,
            ke.nummer as ertragskonto_nummer, ke.bezeichnung as ertragskonto_bezeichnung,
            ka.nummer as aufwand_konto_nummer
     from projekt p
     join auftraggeber a on a.id = p.auftraggeber_id
     left join konto ke on ke.id = p.ertragskonto_id
     left join konto ka on ka.id = p.aufwand_konto_id
     where p.id=$1`, [id]);
  if (!r.rowCount) throw new NotFoundError(`Projekt ${id} nicht gefunden`);
  const x = r.rows[0];
  return {
    ...map(x),
    auftraggeberName: x.auftraggeber_name, auftraggeberZusatz: x.auftraggeber_zusatz,
    auftraggeberStrasse: x.strasse, auftraggeberPlz: x.plz, auftraggeberOrt: x.ort, auftraggeberLand: x.land,
    auftraggeberAdresseUnvollstaendig: x.adresse_unvollstaendig,
    ansprechperson: x.ansprechperson, beschrieb: x.beschrieb, projektleitungKuerzel: x.projektleitung_kuerzel,
    alteProjektNr: x.alte_projekt_nr, aufwandBudgetChf: zahl(x.aufwand_budget_chf),
    ertragskontoNummer: x.ertragskonto_nummer, ertragskontoBezeichnung: x.ertragskonto_bezeichnung,
    aufwandKontoNummer: x.aufwand_konto_nummer,
    fmAbgerechnet: zahl(x.fm_abgerechnet), fmOffenProv: zahl(x.fm_offen_prov),
  };
}

export async function listRechnungenFuerProjekt(pool: pg.Pool, projektId: string): Promise<RechnungListenZeile[]> {
  const r = await pool.query(
    `select id, nummer, datum, status, total_brutto from rechnung
     where projekt_id=$1 order by datum desc, erstellt_am desc`, [projektId]);
  return r.rows.map((x) => ({
    id: x.id, nummer: x.nummer, datum: x.datum, status: x.status, totalBrutto: Number(x.total_brutto),
  }));
}
