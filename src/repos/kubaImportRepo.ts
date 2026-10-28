// SQL des historischen Imports aus Reporting_KUBA.xlsx (tools/kuba-import, Spec v2 §5.4b).
//
// Bewusst direkte Inserts statt saqRepo.createSaqFall / planePruefung / erfasseResultat / stelleZertifikatAus:
// - Historische Daten verletzen heutige Ablaufregeln: RUN2 neben bestandenem RUN1, muendlich ohne
//   Arbeitgeberbestaetigung bzw. ohne bestandene schriftliche Pruefung, Runs in Teilen ausserhalb der Profilvorgabe,
//   Status, die nur ueber Resultate/Zertifikat erreichbar sind. Diese Regeln gelten fuer neue Erfassungen, nicht
//   fuer das Nachtragen der Vergangenheit; die Abweichungen meldet der Import im Data-Quality-Log.
// - Ein Import darf keine Integrationsereignisse ausloesen (createSaqFall publiziert "saq.angemeldet" in die Outbox
//   -> Webhooks/Moodle). Nachvollziehbarkeit stattdessen ueber audit_log ("saq.kuba_import") und integration_lauf.
// Kontakte, Referenten und die Bank-Zuordnung laufen ueber die bestehenden Repos.
import type pg from 'pg';
import type { SaqProfil, SaqSprache, SaqStatus, SaqPruefungArt } from '../domain/saqTypes';
import { SAQ } from '../config/saq';
import { type Db, patchSets, num } from './db';
import { createKontakt } from './kontaktRepo';
import { createReferent } from './referentRepo';
import { findeOrganisationPerName } from './zuordnungRepo';
import { audit } from './auditRepo';

const BENUTZER = 'kuba-import';

// ---------------------------------------------------------------- Transaktion

/** Ganzer Import in EINER Transaktion; Probelauf = alles ausfuehren (Regeln, Constraints) und am Ende zurueckrollen. */
export async function inImportTransaktion<T>(pool: pg.Pool, probelauf: boolean, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const ergebnis = await fn(c);
    await c.query(probelauf ? 'rollback' : 'commit');
    return ergebnis;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** Savepoint je Vorgang: ein Fehler verwirft nur diesen Vorgang (Fehler wird weitergereicht). */
export async function mitSavepoint<T>(c: pg.PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query('savepoint kuba_vorgang');
  try {
    const r = await fn();
    await c.query('release savepoint kuba_vorgang');
    return r;
  } catch (e) {
    await c.query('rollback to savepoint kuba_vorgang');
    throw e;
  }
}

// ---------------------------------------------------------------- Personen, Banken, Experten

export type KubaKontakt = { id: string; nachname: string; vorname: string | null; geburtsdatum: string | null; organisationId: string | null };

const mapKontakt = (r: any): KubaKontakt => ({ id: r.id, nachname: r.nachname, vorname: r.vorname, geburtsdatum: r.geburtsdatum, organisationId: r.organisation_id });

/** Alle aktiven Kontakte fuer den Personenabgleich (Name + Geburtsdatum, Abgleich im Import). */
export async function ladeKontakte(db: Db): Promise<KubaKontakt[]> {
  const r = await db.query('select id, nachname, vorname, geburtsdatum, organisation_id from kontakt where not archiviert order by erstellt_am, id');
  return r.rows.map(mapKontakt);
}

/** Teilnehmende Person aus KUBA (KUBA hat keine E-Mail): minimaler CRM-Kontakt, Herkunft in der Bemerkung. */
export async function legeTeilnehmendeAn(db: Db, k: {
  nachname: string; vorname: string | null; geburtsdatum: string | null; organisationId: string | null; sprache: SaqSprache; herkunft: string;
}): Promise<KubaKontakt> {
  const kontakt = await createKontakt(db, {
    nachname: k.nachname, vorname: k.vorname, geburtsdatum: k.geburtsdatum, organisationId: k.organisationId,
    sprache: k.sprache.toLowerCase(), interessen: ['zertifizierung'], bemerkung: `aus KUBA-Import (${k.herkunft})`,
  });
  return { id: kontakt.id, nachname: kontakt.nachname, vorname: kontakt.vorname, geburtsdatum: kontakt.geburtsdatum, organisationId: kontakt.organisationId };
}

/** Leere Felder eines bestehenden Kontakts ergaenzen, nie ueberschreiben. Liefert die tatsaechlich gesetzten Felder. */
export async function ergaenzeKontakt(db: Db, id: string, felder: { organisationId?: string | null; geburtsdatum?: string | null }): Promise<string[]> {
  const gesetzt: string[] = [];
  if (felder.organisationId) {
    const r = await db.query('update kontakt set organisation_id=$2, geaendert_am=now() where id=$1 and organisation_id is null', [id, felder.organisationId]);
    if (r.rowCount) gesetzt.push('organisationId');
  }
  if (felder.geburtsdatum) {
    const r = await db.query('update kontakt set geburtsdatum=$2, geaendert_am=now() where id=$1 and geburtsdatum is null', [id, felder.geburtsdatum]);
    if (r.rowCount) gesetzt.push('geburtsdatum');
  }
  return gesetzt;
}

/** Bank per Name (inkl. Aliase aus bbz-saq); nur eindeutige Treffer. Unbekannte Banken werden NICHT angelegt. */
export function findeOrganisation(db: Db, name: string | null): Promise<string | null> {
  return findeOrganisationPerName(db, name);
}

export async function ladeReferenten(db: Db): Promise<{ id: string; anzeigename: string }[]> {
  const r = await db.query('select id, anzeigename from referent order by id');
  return r.rows.map((x: any) => ({ id: x.id, anzeigename: x.anzeigename }));
}

/**
 * Experte der muendlichen Pruefung (in KUBA nur ein Name): minimaler CRM-Kontakt (ganzer Name als Nachname,
 * Aufteilung Vor-/Nachname ungeprueft) + externer Referent. Beide mit Bemerkung "aus KUBA".
 */
export async function legeExpertenAn(db: Db, name: string): Promise<string> {
  const kontakt = await createKontakt(db, { nachname: name, rolle: 'Referent', bemerkung: 'aus KUBA (Expertenname; Aufteilung Vor-/Nachname ungeprueft)' });
  const ref = await createReferent(db, {
    typ: 'extern', kontaktId: kontakt.id, anzeigename: name, fachgebiete: ['SAQ-Pruefung'],
    bemerkung: 'aus KUBA (Experte muendliche SAQ-Pruefung)',
  });
  return ref.id;
}

// ---------------------------------------------------------------- SAQ-Faelle und Runs

export type KubaFallRun = {
  art: SaqPruefungArt; teil: number; run: number; datum: string; bestanden: boolean | null; resultatProzent: number | null;
  score: number | null; ort: string | null; remote: boolean; experte1Id: string | null; experte2Id: string | null;
};

export type KubaFall = {
  id: string; kontaktId: string; profil: SaqProfil; status: SaqStatus; kubaHerkunft: string | null; zertifizierungId: string | null;
  organisationId: string | null; rolle: string | null; kennzeichnung: string | null; runs: KubaFallRun[];
};

const mapRun = (r: any): KubaFallRun => ({
  art: r.art, teil: r.teil, run: r.run, datum: r.datum, bestanden: r.bestanden, resultatProzent: num(r.resultat_prozent),
  score: num(r.score), ort: r.ort, remote: r.remote, experte1Id: r.experte1_id, experte2Id: r.experte2_id,
});

async function mitRuns(db: Db, rows: any[]): Promise<KubaFall[]> {
  const runs = rows.length
    ? (await db.query('select * from saq_pruefung where fall_id = any($1::uuid[]) order by art, teil, run', [rows.map((r) => r.id)])).rows
    : [];
  return rows.map((r) => ({
    id: r.id, kontaktId: r.kontakt_id, profil: r.profil, status: r.status, kubaHerkunft: r.kuba_herkunft, zertifizierungId: r.zertifizierung_id,
    organisationId: r.organisation_id, rolle: r.rolle, kennzeichnung: r.kennzeichnung,
    runs: runs.filter((x: any) => x.fall_id === r.id).map(mapRun),
  }));
}

/** Faelle mit KUBA-Herkunft samt Name/Geburtsdatum des Kontakts (Vorabzuordnung ueber "Sheet:Zeile"). */
export async function ladeFaelleMitHerkunft(db: Db): Promise<{ id: string; profil: SaqProfil; kubaHerkunft: string; nachname: string; vorname: string | null; geburtsdatum: string | null }[]> {
  const r = await db.query(
    `select f.id, f.profil, f.kuba_herkunft, k.nachname, k.vorname, k.geburtsdatum
     from saq_fall f join kontakt k on k.id = f.kontakt_id where f.kuba_herkunft is not null order by f.erstellt_am, f.id`);
  return r.rows.map((x: any) => ({ id: x.id, profil: x.profil, kubaHerkunft: x.kuba_herkunft, nachname: x.nachname, vorname: x.vorname, geburtsdatum: x.geburtsdatum }));
}

export async function ladeFall(db: Db, id: string): Promise<KubaFall> {
  return (await mitRuns(db, (await db.query('select * from saq_fall where id=$1', [id])).rows))[0];
}

/** Alle Faelle einer Person fuer ein Profil (aelteste zuerst), mit Runs. */
export async function ladeFaelle(db: Db, kontaktId: string, profil: SaqProfil): Promise<KubaFall[]> {
  const r = await db.query('select * from saq_fall where kontakt_id=$1 and profil=$2 order by erstellt_am, id', [kontaktId, profil]);
  return mitRuns(db, r.rows);
}

export type KubaFallInput = {
  kontaktId: string; organisationId: string | null; profil: SaqProfil; sprache: SaqSprache; rolle: string | null;
  kennzeichnung: string | null; status: SaqStatus; kubaHerkunft: string; bemerkung: string; zertifizierungId: string | null;
};

export async function legeFallAn(db: Db, f: KubaFallInput): Promise<string> {
  const r = await db.query(
    `insert into saq_fall(kontakt_id, organisation_id, profil, sprache, rolle, kennzeichnung, status, kuba_herkunft, bemerkung, zertifizierung_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [f.kontaktId, f.organisationId, f.profil, f.sprache, f.rolle, f.kennzeichnung, f.status, f.kubaHerkunft, f.bemerkung, f.zertifizierungId]);
  return r.rows[0].id;
}

export type KubaFallPatch = Partial<Pick<KubaFallInput, 'organisationId' | 'rolle' | 'kennzeichnung' | 'status' | 'kubaHerkunft' | 'zertifizierungId'>>;

export async function aktualisiereFall(db: Db, id: string, patch: KubaFallPatch): Promise<void> {
  const args: unknown[] = [id];
  const sets = patchSets(patch as Record<string, unknown>, {
    organisationId: 'organisation_id', rolle: 'rolle', kennzeichnung: 'kennzeichnung', status: 'status', kubaHerkunft: 'kuba_herkunft',
    zertifizierungId: 'zertifizierung_id',
  }, args);
  if (!sets.length) return;
  await db.query(`update saq_fall set ${sets.join(',')}, geaendert_am=now() where id=$1`, args);
}

export async function legeRunAn(db: Db, fallId: string, r: KubaFallRun): Promise<void> {
  await db.query(
    `insert into saq_pruefung(fall_id, art, teil, run, datum, ort, remote, score, resultat_prozent, bestanden, experte1_id, experte2_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [fallId, r.art, r.teil, r.run, r.datum, r.ort, r.remote, r.score, r.resultatProzent, r.bestanden, r.experte1Id, r.experte2Id]);
}

export type KubaRunErgaenzung = Partial<Pick<KubaFallRun, 'bestanden' | 'resultatProzent' | 'score' | 'ort' | 'remote' | 'experte1Id' | 'experte2Id'>>;

/** Setzt nur die uebergebenen Felder eines bestehenden Runs (der Import uebergibt nur Luecken). */
export async function ergaenzeRun(db: Db, fallId: string, schluessel: { art: SaqPruefungArt; teil: number; run: number }, felder: KubaRunErgaenzung): Promise<void> {
  const args: unknown[] = [fallId, schluessel.art, schluessel.teil, schluessel.run];
  const sets = patchSets(felder as Record<string, unknown>, {
    bestanden: 'bestanden', resultatProzent: 'resultat_prozent', score: 'score', ort: 'ort', remote: 'remote', experte1Id: 'experte1_id', experte2Id: 'experte2_id',
  }, args);
  if (!sets.length) return;
  await db.query(`update saq_pruefung set ${sets.join(',')} where fall_id=$1 and art=$2 and teil=$3 and run=$4`, args);
}

// ---------------------------------------------------------------- Zertifikat

/** Bestehendes SAQ-Zertifikat einer Person am selben Ausstellungsdatum (Eindeutigkeit kontakt/typ/ausgestellt_am). */
export async function findeZertifizierung(db: Db, kontaktId: string, ausgestelltAm: string): Promise<{ id: string; profil: SaqProfil | null; zertifikatNr: string | null } | null> {
  const r = await db.query('select id, profil, zertifikat_nr from zertifizierung where kontakt_id=$1 and typ=$2 and ausgestellt_am=$3',
    [kontaktId, SAQ.zertifikatTyp, ausgestelltAm]);
  return r.rowCount ? { id: r.rows[0].id, profil: r.rows[0].profil, zertifikatNr: r.rows[0].zertifikat_nr } : null;
}

/** Historisches Zertifikat; Status "abgelaufen", wenn die Gueltigkeit vor dem Stichtag endet. */
export async function legeZertifizierungAn(db: Db, z: {
  kontaktId: string; profil: SaqProfil; sprache: SaqSprache; nr: string | null; ausgestelltAm: string; gueltigBis: string; stichtag: string;
}): Promise<string> {
  const r = await db.query(
    `insert into zertifizierung(kontakt_id, typ, profil, sprache, zertifikat_nr, ausgestellt_am, gueltig_bis, status)
     values ($1,$2,$3,$4,$5,$6,$7, case when $7::date < $8::date then 'abgelaufen' else 'aktiv' end) returning id`,
    [z.kontaktId, SAQ.zertifikatTyp, z.profil, z.sprache, z.nr, z.ausgestelltAm, z.gueltigBis, z.stichtag]);
  return r.rows[0].id;
}

// ---------------------------------------------------------------- Protokoll und Auswertung

/** Revisionsspur je angelegtem oder ergaenztem Fall. */
export function protokolliereFall(db: Db, fallId: string, details: Record<string, unknown>): Promise<void> {
  return audit(db, { benutzer: BENUTZER, aktion: 'saq.kuba_import', entitaet: 'saq_fall', entitaetId: fallId, details });
}

/** Lauf in integration_lauf (Admin-Oberflaeche); nur Zaehler, keine Personendaten. */
export async function protokolliereLauf(db: Db, status: 'ok' | 'teilweise', ergebnis: Record<string, unknown>): Promise<void> {
  await db.query(`insert into integration_lauf(typ, beendet_am, status, ergebnis) values ('kuba.import', now(), $1, $2)`, [status, JSON.stringify(ergebnis)]);
}

/** Status je Profil aller Faelle mit KUBA-Herkunft (Abgleich mit dem Cockpit bbz-saq). */
export async function statusJeProfil(db: Db): Promise<{ profil: SaqProfil; status: SaqStatus; anzahl: number }[]> {
  const r = await db.query(
    `select profil, status, count(*)::int as anzahl from saq_fall where kuba_herkunft is not null group by profil, status order by profil, status`);
  return r.rows.map((x: any) => ({ profil: x.profil, status: x.status, anzahl: x.anzahl }));
}
