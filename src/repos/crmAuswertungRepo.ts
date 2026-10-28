/**
 * CRM-Auswertungen (nur lesend): 360°-Sichten, Wiedervorlagen, Dashboard.
 * Liest Tabellen anderer Module (aufgabe, projekt, rechnung, anmeldung, lernnachweis, zertifizierung) per SQL.
 */
import type pg from 'pg';
import type {
  CrmAufgabe, Organisation360, Kontakt360, ProjektKurz, AnmeldungKurz, LernnachweisKurz, ZertifizierungKurz,
  Wiedervorlagen, CrmDashboard,
} from '../domain/crmTypes';
import { bucketWiedervorlagen, aggregierePipeline, pflegeabdeckung } from '../domain/crm';
import { getOrganisation, findAuftraggeberFuerOrganisation } from './organisationRepo';
import { getKontakt, listKontakte } from './kontaktRepo';
import { listAktivitaeten, tagesbeginn } from './aktivitaetRepo';
import { listVerkaufschancen } from './verkaufschanceRepo';
import { listAnfragen } from './anfrageRepo';
import { type Db, num } from './db';

const ABGESCHLOSSENE_AUFGABEN = `('erledigt','abgebrochen')`;

/** Aufgabe inkl. Anzeigenamen; Organisation direkt, ueber den Kontakt oder ueber die Verkaufschance. */
const AUFGABE_SELECT = `
  select a.*, nullif(trim(concat_ws(' ', k.vorname, k.nachname)), '') as kontakt_name, o.name as organisation_name, v.titel as verkaufschance_titel
  from aufgabe a
  left join kontakt k on k.id = a.kontakt_id
  left join verkaufschance v on v.id = a.verkaufschance_id
  left join organisation o on o.id = coalesce(a.organisation_id, k.organisation_id, v.organisation_id)`;

const mapAufgabe = (r: any): CrmAufgabe => ({
  id: r.id, titel: r.titel, status: r.status, prioritaet: r.prioritaet, faelligAm: r.faellig_am, zustaendigId: r.zustaendig_id,
  projektId: r.projekt_id, kontaktId: r.kontakt_id, organisationId: r.organisation_id, verkaufschanceId: r.verkaufschance_id,
  kontaktName: r.kontakt_name, organisationName: r.organisation_name, verkaufschanceTitel: r.verkaufschance_titel,
});

export async function ladeOrganisation360(pool: pg.Pool, id: string): Promise<Organisation360> {
  const organisation = await getOrganisation(pool, id);
  const [kontakte, aktivitaeten, aufgaben, verkaufschancen, projekte, auftraggeber, umsatz] = await Promise.all([
    listKontakte(pool, { organisationId: id }),
    listAktivitaeten(pool, { organisationId: id, limit: 20 }),
    pool.query(`${AUFGABE_SELECT}
      where a.status not in ${ABGESCHLOSSENE_AUFGABEN} and (a.organisation_id=$1 or k.organisation_id=$1 or v.organisation_id=$1)
      order by a.faellig_am asc nulls last, a.erstellt_am`, [id]),
    listVerkaufschancen(pool, { organisationId: id }),
    pool.query(
      `select p.id, p.nummer, p.name, p.jahr, p.status, p.bereich, p.auftraggeber_id from projekt p
       join auftraggeber ag on ag.id = p.auftraggeber_id where ag.organisation_id=$1 order by p.jahr desc, p.stammnummer`, [id]),
    findAuftraggeberFuerOrganisation(pool, id),
    pool.query(
      `select extract(year from r.datum)::int as jahr, sum(r.total_netto) as netto from rechnung r
       join auftraggeber ag on ag.id = r.auftraggeber_id
       where ag.organisation_id=$1 and r.status in ('abgerechnet','bezahlt') group by 1 order by 1 desc`, [id]),
  ]);
  return {
    ...organisation, kontakte, aktivitaeten, offeneAufgaben: aufgaben.rows.map(mapAufgabe),
    verkaufschancen: verkaufschancen.map(({ organisationName: _, ...v }) => v),
    projekte: projekte.rows.map((p: any): ProjektKurz => ({
      id: p.id, nummer: p.nummer, name: p.name, jahr: p.jahr, status: p.status, bereich: p.bereich, auftraggeberId: p.auftraggeber_id,
    })),
    auftraggeber,
    umsatzProJahr: umsatz.rows.map((u: any) => ({ jahr: u.jahr, nettoChf: Number(u.netto) })),
  };
}

export async function ladeKontakt360(db: Db, id: string): Promise<Kontakt360> {
  const kontakt = await getKontakt(db, id);
  const [organisation, aktivitaeten, aufgaben, verkaufschancen, anmeldungen, lernnachweise, zertifizierungen] = await Promise.all([
    kontakt.organisationId ? getOrganisation(db, kontakt.organisationId) : Promise.resolve(null),
    listAktivitaeten(db, { kontaktId: id, limit: 50 }),
    db.query(`${AUFGABE_SELECT} where a.kontakt_id=$1
      order by (a.status in ${ABGESCHLOSSENE_AUFGABEN}), a.faellig_am asc nulls last, a.erstellt_am limit 100`, [id]),
    listVerkaufschancen(db, { kontaktId: id }),
    db.query(
      `select an.*, d.code as durchfuehrung_code, coalesce(d.titel, ka.titel) as titel, d.start_datum, d.end_datum
       from anmeldung an join durchfuehrung d on d.id = an.durchfuehrung_id join kursangebot ka on ka.id = d.kursangebot_id
       where an.kontakt_id=$1 order by d.start_datum desc`, [id]),
    db.query('select * from lernnachweis where kontakt_id=$1 order by datum desc, erstellt_am desc', [id]),
    db.query('select * from zertifizierung where kontakt_id=$1 order by gueltig_bis desc', [id]),
  ]);
  return {
    ...kontakt, organisation, aktivitaeten, aufgaben: aufgaben.rows.map(mapAufgabe),
    verkaufschancen: verkaufschancen.map(({ organisationName: _, ...v }) => v),
    anmeldungen: anmeldungen.rows.map((r: any): AnmeldungKurz => ({
      id: r.id, durchfuehrungId: r.durchfuehrung_id, durchfuehrungCode: r.durchfuehrung_code, titel: r.titel,
      startDatum: r.start_datum, endDatum: r.end_datum, status: r.status, preisChf: num(r.preis_chf),
      angemeldetAm: new Date(r.angemeldet_am).toISOString(),
    })),
    lernnachweise: lernnachweise.rows.map((r: any): LernnachweisKurz => ({
      id: r.id, anmeldungId: r.anmeldung_id, datum: r.datum, titel: r.titel, lernstunden: Number(r.lernstunden), kategorie: r.kategorie, quelle: r.quelle,
    })),
    zertifizierungen: zertifizierungen.rows.map((r: any): ZertifizierungKurz => ({
      id: r.id, typ: r.typ, zertifikatNr: r.zertifikat_nr, ausgestelltAm: r.ausgestellt_am, gueltigBis: r.gueltig_bis, status: r.status,
    })),
  };
}

/** Offene Aufgaben ohne Projekt (CRM-Wiedervorlagen), gruppiert relativ zum Stichtag. */
export async function ladeWiedervorlagen(db: Db, filter: { stichtag: string; mitarbeitendeId?: string }): Promise<Wiedervorlagen<CrmAufgabe>> {
  const args: unknown[] = [];
  let mitarbeitende = '';
  if (filter.mitarbeitendeId) { args.push(filter.mitarbeitendeId); mitarbeitende = `and a.zustaendig_id=$${args.length}`; }
  const r = await db.query(`${AUFGABE_SELECT}
    where a.projekt_id is null and a.status not in ${ABGESCHLOSSENE_AUFGABEN} ${mitarbeitende}
    order by a.faellig_am asc nulls last, a.erstellt_am`, args);
  return bucketWiedervorlagen(r.rows.map(mapAufgabe), filter.stichtag);
}

/**
 * CRM-Dashboard zum Stichtag. `mitarbeitendeId` schraenkt Wiedervorlagen (zustaendig) und Pipeline (verantwortlich) ein;
 * Anfragen, Aktivitaeten und Pflegeabdeckung sind gesamthaft. Zeitfenster in Kalendertagen (Europe/Zurich) inkl. Stichtag.
 */
export async function ladeCrmDashboard(db: Db, filter: { stichtag: string; mitarbeitendeId?: string }): Promise<CrmDashboard> {
  const { stichtag, mitarbeitendeId } = filter;
  const fenster = (tage: number) => `a.datum >= ${tagesbeginn(`$1::date - ${tage - 1}`)} and a.datum < ${tagesbeginn('$1::date + 1')}`;
  const pipelineArgs: unknown[] = mitarbeitendeId ? [mitarbeitendeId] : [];
  const [anfragenAnzahl, neueste, wiedervorlagen, pipelineRows, aktivitaeten, pflege] = await Promise.all([
    db.query(`select count(*)::int as n from anfrage where status='neu'`),
    listAnfragen(db, { status: 'neu', limit: 5 }),
    ladeWiedervorlagen(db, { stichtag, mitarbeitendeId }),
    db.query(`select phase, wert_chf, wahrscheinlichkeit, erwarteter_abschluss from verkaufschance
              where phase in ('lead','qualifiziert','offeriert','verhandlung') ${mitarbeitendeId ? 'and verantwortlich_id=$1' : ''}`, pipelineArgs),
    db.query(`select a.typ, count(*)::int as n from aktivitaet a where ${fenster(30)} group by a.typ order by a.typ`, [stichtag]),
    db.query(
      `select o.klassifizierung, count(*)::int as organisationen,
         (count(*) filter (where exists (
            select 1 from aktivitaet a
            where (a.organisation_id = o.id or a.kontakt_id in (select k.id from kontakt k where k.organisation_id = o.id))
              and ${fenster(365)})))::int as gepflegt
       from organisation o where not o.archiviert group by o.klassifizierung`, [stichtag]),
  ]);
  const pipeline = aggregierePipeline(pipelineRows.rows.map((x: any) => ({
    phase: x.phase, wertChf: num(x.wert_chf), wahrscheinlichkeit: x.wahrscheinlichkeit, erwarteterAbschluss: x.erwarteter_abschluss,
  })));
  return {
    stichtag,
    neueAnfragen: { anzahl: anfragenAnzahl.rows[0].n, neueste },
    wiedervorlagen: {
      ueberfaellig: wiedervorlagen.ueberfaellig.length, dieseWoche: wiedervorlagen.dieseWoche.length,
      spaeter: wiedervorlagen.spaeter.length, ohneTermin: wiedervorlagen.ohneTermin.length,
    },
    pipeline: pipeline.offen,
    aktivitaeten30Tage: {
      anzahl: aktivitaeten.rows.reduce((s: number, x: any) => s + x.n, 0),
      jeTyp: Object.fromEntries(aktivitaeten.rows.map((x: any) => [x.typ, x.n])),
    },
    pflegeabdeckung: pflegeabdeckung(pflege.rows),
  };
}
