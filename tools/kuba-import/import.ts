import type pg from 'pg';
import type { SaqStatus } from '../../src/domain/saqTypes';
import { SAQ_PROFILE } from '../../src/config/saq';
import { SAQ_STATUS, istOffen, heute as heuteZuerich } from '../../src/domain/saq';
import {
  inImportTransaktion, mitSavepoint, ladeKontakte, legeTeilnehmendeAn, ergaenzeKontakt, findeOrganisation, ladeReferenten,
  legeExpertenAn, ladeFaelleMitHerkunft, ladeFall, ladeFaelle, legeFallAn, aktualisiereFall, legeRunAn, ergaenzeRun,
  findeZertifizierung, legeZertifizierungAn, protokolliereFall, protokolliereLauf, statusJeProfil,
  type KubaKontakt, type KubaFall, type KubaFallRun, type KubaFallPatch, type KubaRunErgaenzung,
} from '../../src/repos/kubaImportRepo';
import {
  leseKuba, normalisiereNamensteil, runFeld, KUBA_STATUS,
  type KubaVorgang, type ErpAbbildung, type ErpRun, type DqEintrag, type KubaStatus, type Quelle, type Stufe,
} from './kuba';

/*
 * Historischer Import der SAQ-Daten aus Reporting_KUBA.xlsx (Spec v2 §5.4b). Ablauf in EINER Transaktion, ein
 * Savepoint je Vorgang (ein Fehler verwirft nur diesen Vorgang). Probelauf = alles ausfuehren, dann rollback.
 *
 * Je Vorgang (Person x Profil, Duplikate zusammengefuehrt):
 *   Person   -> kontakt: (Nachname, Vorname, Geburtsdatum) normalisiert wie der bbz-saq-Personenschluessel; ohne
 *               Geburtsdatum nur ein eindeutiger Kontakt gleichen Namens ohne Geburtsdatum; sonst neuer Kontakt.
 *   Employer -> organisation ueber findeOrganisationPerName (Aliase); unbekannte Banken werden NICHT angelegt
 *               (Bericht + saq_fall.bemerkung).
 *   Vorgang  -> saq_fall (kuba_herkunft "Sheet:Zeile[; Sheet:Zeile]"), Runs -> saq_pruefung, Experten -> referent,
 *               Zertifikat -> zertifizierung.
 * Idempotent: bestehender Fall ueber kuba_herkunft (+ gleiche Person/gleiches Profil), sonst Person + Profil ohne
 * widerspruechliche Runs. Bestehendes wird nur ergaenzt (Luecken), nie ueberschrieben; Status nur vorwaerts.
 */

export type KubaBericht = {
  probelauf: boolean; datei: string | null; stichtag: string;
  zeilen: Record<Quelle, number>; ohneName: number; vorgaenge: number; duplikate: number; profilKonflikte: number;
  faelle: { neu: number; vorhanden: number; fehler: number };
  nichtImportiert: { herkunft: string; grund: string }[];
  personen: { neu: number; gematcht: number; ohneGeburtsdatum: number; moeglicheDubletten: number };
  organisationen: {
    zugeordnet: { organisationen: number; vorgaenge: number };
    nichtZugeordnet: { name: string; kanon: string | null; vorgaenge: number }[];
    ohneArbeitgeber: number;
  };
  runs: { neu: number; ergaenzt: number; vorhanden: number };
  zertifikate: { neu: number; vorhanden: number };
  experten: { neu: number; gematcht: number };
  statusJeProfil: { profil: string; kuba: Record<KubaStatus, number>; erp: Record<SaqStatus, number> }[];
  dq: DqEintrag[];
  fehler: { herkunft: string; grund: string }[];
};

/** Status nur vorwaerts: offene Faelle steigen auf, abgeschlossene bleiben (ausser bestanden -> zertifiziert). */
const RANG: Record<SaqStatus, number> = {
  angemeldet: 0, in_pruefung: 1, schriftlich_bestanden: 2, bestanden: 3, nicht_bestanden: 3, zertifiziert: 4, abgebrochen: 5,
};
export function statusVorwaerts(alt: SaqStatus, neu: SaqStatus): SaqStatus {
  if (istOffen(alt)) return RANG[neu] > RANG[alt] ? neu : alt;
  return alt === 'bestanden' && neu === 'zertifiziert' ? neu : alt;
}

const runSchluessel = (r: { art: string; teil: number; run: number }) => `${r.art}|${r.teil}|${r.run}`;
const kuerzel = (r: { art: string; teil: number; run: number }) => `${r.art === 'schriftlich' ? 'WE' : 'OE'}${r.teil} RUN${r.run}`;
const herkunftTokens = (h: string | null) => (h ?? '').split(';').map((t) => t.trim()).filter(Boolean);
const nameKey = (nachname: string | null, vorname: string | null) => `${normalisiereNamensteil(nachname)}|${normalisiereNamensteil(vorname)}`;

/** Widerspruch zwischen ERP-Runs und KUBA-Runs: gleicher Run mit anderem Datum oder anderem Ergebnis. */
function widerspricht(erp: KubaFallRun[], kuba: ErpRun[]): boolean {
  const k = new Map(kuba.map((r) => [runSchluessel(r), r]));
  return erp.some((e) => {
    const x = k.get(runSchluessel(e));
    return !!x && (x.datum !== e.datum || (x.bestanden !== null && e.bestanden !== null && x.bestanden !== e.bestanden));
  });
}

/**
 * Zwischenspeicher des Laufs (Personen-, Experten-, Bankindex, belegte Faelle). Aenderungen werden je Vorgang
 * protokolliert und beim Zurueckrollen des Savepoints rueckgaengig gemacht – sonst zeigte der Index auf Kontakte,
 * die es nach dem Rollback nicht mehr gibt.
 */
class Kontext {
  private journal: (() => void)[] = [];
  readonly jeSchluessel = new Map<string, KubaKontakt[]>();
  readonly jeName = new Map<string, KubaKontakt[]>();
  readonly jeId = new Map<string, KubaKontakt>();
  readonly experten = new Map<string, string>();
  readonly banken = new Map<string, string | null>();
  readonly belegt = new Set<string>();
  readonly kontakteNeu = new Set<string>();
  readonly kontakteGematcht = new Set<string>();
  readonly expertenNeu = new Set<string>();
  readonly expertenGematcht = new Set<string>();

  constructor(kontakte: KubaKontakt[], referenten: { id: string; anzeigename: string }[]) {
    for (const k of kontakte) this.indexiere(k);
    for (const r of referenten) {
      const key = normalisiereNamensteil(r.anzeigename);
      if (key && !this.experten.has(key)) this.experten.set(key, r.id);
    }
    this.bestaetige();
  }

  private merke(undo: () => void) { this.journal.push(undo); }
  bestaetige() { this.journal = []; }
  verwerfe() { for (const undo of this.journal.reverse()) undo(); this.journal = []; }

  fuege<T>(set: Set<T>, wert: T) {
    if (set.has(wert)) return;
    set.add(wert);
    this.merke(() => set.delete(wert));
  }

  setze<K, V>(map: Map<K, V>, key: K, wert: V) {
    const hatte = map.has(key); const alt = map.get(key);
    map.set(key, wert);
    this.merke(() => (hatte ? map.set(key, alt as V) : map.delete(key)));
  }

  private haenge(map: Map<string, KubaKontakt[]>, key: string, k: KubaKontakt) {
    const alt = map.get(key) ?? [];
    map.set(key, [...alt, k]);
    this.merke(() => (alt.length ? map.set(key, alt) : map.delete(key)));
  }

  indexiere(k: KubaKontakt) {
    this.haenge(this.jeName, nameKey(k.nachname, k.vorname), k);
    if (k.geburtsdatum) this.haenge(this.jeSchluessel, `${nameKey(k.nachname, k.vorname)}|${k.geburtsdatum}`, k);
    this.setze(this.jeId, k.id, k);
  }

  /** Kontakt wurde ergaenzt (Bank/Geburtsdatum): Index nachfuehren, damit weitere Zeilen derselben Person ihn finden. */
  ergaenzt(k: KubaKontakt, felder: { organisationId: string | null; geburtsdatum: string | null }) {
    const neu = { ...k, organisationId: k.organisationId ?? felder.organisationId, geburtsdatum: k.geburtsdatum ?? felder.geburtsdatum };
    this.setze(this.jeId, k.id, neu);
    if (!k.geburtsdatum && neu.geburtsdatum) this.haenge(this.jeSchluessel, `${nameKey(k.nachname, k.vorname)}|${neu.geburtsdatum}`, neu);
  }
}

type Delta = {
  ergebnis: 'neu' | 'vorhanden'; runs: { neu: number; ergaenzt: number; vorhanden: number }; zertNeu: number; zertVorhanden: number;
  moeglicheDublette: boolean; bank: { orgId: string | null; name: string | null; kanon: string | null };
};

export async function importiere(pool: pg.Pool, daten: Uint8Array, opts: { probelauf?: boolean; heute?: string; datei?: string } = {}): Promise<KubaBericht> {
  const probelauf = opts.probelauf ?? true;
  const stichtag = opts.heute ?? heuteZuerich();
  const kuba = leseKuba(daten, stichtag);   // Strukturfehler (Header/Sheet) brechen hier ab, vor jedem DB-Zugriff
  const importierbar = kuba.vorgaenge.filter((v) => v.erp);
  const bericht: KubaBericht = {
    probelauf, datei: opts.datei ?? null, stichtag,
    zeilen: kuba.zaehler.zeilen, ohneName: kuba.zaehler.ohneName, vorgaenge: kuba.zaehler.vorgaenge,
    duplikate: kuba.zaehler.duplikate, profilKonflikte: kuba.zaehler.profilKonflikte,
    faelle: { neu: 0, vorhanden: 0, fehler: 0 },
    nichtImportiert: kuba.vorgaenge.filter((v) => !v.erp).map((v) => ({ herkunft: v.herkunft.join('; '), grund: v.nichtImportierbar ?? 'nicht importierbar' })),
    personen: { neu: 0, gematcht: 0, ohneGeburtsdatum: kuba.zaehler.ohneGeburtsdatum, moeglicheDubletten: 0 },
    organisationen: { zugeordnet: { organisationen: 0, vorgaenge: 0 }, nichtZugeordnet: [], ohneArbeitgeber: 0 },
    runs: { neu: 0, ergaenzt: 0, vorhanden: 0 },
    zertifikate: { neu: 0, vorhanden: 0 },
    experten: { neu: 0, gematcht: 0 },
    statusJeProfil: [],
    dq: [...kuba.dq],
    fehler: [],
  };

  return inImportTransaktion(pool, probelauf, async (c) => {
    const ctx = new Kontext(await ladeKontakte(c), await ladeReferenten(c));
    const reservierung = await reserviereUeberHerkunft(c, importierbar);
    const reserviert = new Set([...reservierung.values()].map((f) => f.id));
    const jePersonProfil = new Map<string, number>();
    for (const v of importierbar) jePersonProfil.set(`${v.personKey}|${v.profil}`, (jePersonProfil.get(`${v.personKey}|${v.profil}`) ?? 0) + 1);

    const banken = new Set<string>();
    const ohneBank = new Map<string, { name: string; kanon: string | null; vorgaenge: number }>();
    for (const v of importierbar) {
      const dq: DqEintrag[] = [];
      const log = (key: string, grund: string, stufe: Stufe = 'hinweis') => dq.push({ stufe, sheet: v.sheet, zeile: v.zeile, header: v.headerName(key), roh: '', grund });
      try {
        const d = await mitSavepoint(c, () => verarbeite(c, v, v.erp as ErpAbbildung, ctx, {
          stichtag, log, reserviert: reservierung.get(v) ?? null, gesperrt: reserviert, einzig: jePersonProfil.get(`${v.personKey}|${v.profil}`) === 1,
        }));
        ctx.bestaetige();
        bericht.dq.push(...dq);
        bericht.faelle[d.ergebnis]++;
        for (const k of ['neu', 'ergaenzt', 'vorhanden'] as const) bericht.runs[k] += d.runs[k];
        bericht.zertifikate.neu += d.zertNeu;
        bericht.zertifikate.vorhanden += d.zertVorhanden;
        if (d.moeglicheDublette) bericht.personen.moeglicheDubletten++;
        if (!d.bank.name) bericht.organisationen.ohneArbeitgeber++;
        else if (d.bank.orgId) { banken.add(d.bank.orgId); bericht.organisationen.zugeordnet.vorgaenge++; }
        else {
          const e = ohneBank.get(d.bank.name) ?? { name: d.bank.name, kanon: d.bank.kanon !== d.bank.name ? d.bank.kanon : null, vorgaenge: 0 };
          e.vorgaenge++;
          ohneBank.set(d.bank.name, e);
        }
      } catch (e) {
        ctx.verwerfe();
        const grund = (e as Error).message;
        bericht.faelle.fehler++;
        bericht.fehler.push({ herkunft: v.herkunft.join('; '), grund });
        bericht.dq.push({ stufe: 'fehler', sheet: v.sheet, zeile: v.zeile, header: v.headerName('nachname'), roh: '', grund: `Vorgang nicht importiert: ${grund}` });
      }
    }

    bericht.personen.neu = ctx.kontakteNeu.size;
    bericht.personen.gematcht = ctx.kontakteGematcht.size;
    bericht.experten = { neu: ctx.expertenNeu.size, gematcht: ctx.expertenGematcht.size };
    bericht.organisationen.zugeordnet.organisationen = banken.size;
    bericht.organisationen.nichtZugeordnet = [...ohneBank.values()].sort((a, b) => b.vorgaenge - a.vorgaenge || a.name.localeCompare(b.name));
    bericht.statusJeProfil = statusTabelle(kuba.vorgaenge, await statusJeProfil(c));
    const reihenfolge = (d: DqEintrag) => `${d.sheet === 'First Certification' ? 0 : 1}|${String(d.zeile).padStart(7, '0')}`;
    bericht.dq.sort((a, b) => reihenfolge(a).localeCompare(reihenfolge(b)));
    await protokolliereLauf(c, bericht.faelle.fehler || bericht.nichtImportiert.length ? 'teilweise' : 'ok', {
      datei: bericht.datei, stichtag, vorgaenge: bericht.vorgaenge, faelleNeu: bericht.faelle.neu, faelleVorhanden: bericht.faelle.vorhanden,
      faelleFehler: bericht.faelle.fehler, nichtImportiert: bericht.nichtImportiert.length, runsNeu: bericht.runs.neu, runsErgaenzt: bericht.runs.ergaenzt,
      zertifikateNeu: bericht.zertifikate.neu, personenNeu: bericht.personen.neu, dqFehler: bericht.dq.filter((d) => d.stufe === 'fehler').length,
    });
    return bericht;
  });
}

/**
 * Vorabzuordnung ueber kuba_herkunft: Fall mit gemeinsamer "Sheet:Zeile", gleichem Profil und gleicher Person
 * (Name; Geburtsdatum, wo beide eines haben). Vor dem Lauf, damit eine neue Zeile derselben Person keinen Fall
 * "wegnimmt", der einer anderen Zeile der Datei gehoert.
 */
async function reserviereUeberHerkunft(c: pg.PoolClient, vorgaenge: KubaVorgang[]): Promise<Map<KubaVorgang, { id: string }>> {
  const faelle = await ladeFaelleMitHerkunft(c);
  const jeToken = new Map<string, typeof faelle>();
  for (const f of faelle) for (const t of herkunftTokens(f.kubaHerkunft)) jeToken.set(t, [...(jeToken.get(t) ?? []), f]);
  const vergeben = new Set<string>();
  const out = new Map<KubaVorgang, { id: string }>();
  for (const v of vorgaenge) {
    const kandidaten = v.herkunft.flatMap((t) => jeToken.get(t) ?? []);
    const f = kandidaten.find((x) => !vergeben.has(x.id) && x.profil === v.profil && nameKey(x.nachname, x.vorname) === nameKey(v.nachname, v.vorname)
      && (!x.geburtsdatum || !v.geburtsdatum || x.geburtsdatum === v.geburtsdatum));
    if (f) { vergeben.add(f.id); out.set(v, { id: f.id }); }
  }
  return out;
}

type Umgebung = {
  stichtag: string; log: (key: string, grund: string, stufe?: Stufe) => void;
  reserviert: { id: string } | null; gesperrt: Set<string>; einzig: boolean;
};

async function verarbeite(c: pg.PoolClient, v: KubaVorgang, erp: ErpAbbildung, ctx: Kontext, u: Umgebung): Promise<Delta> {
  const profil = v.profil!;
  const herkunft = v.herkunft.join('; ');
  const delta: Delta = {
    ergebnis: 'neu', runs: { neu: 0, ergaenzt: 0, vorhanden: 0 }, zertNeu: 0, zertVorhanden: 0, moeglicheDublette: false,
    bank: { orgId: null, name: v.arbeitgeber, kanon: v.arbeitgeberKanon },
  };

  // Bank (Cache je Rohname; Organisationen werden nie angelegt)
  if (v.arbeitgeber) {
    if (!ctx.banken.has(v.arbeitgeber)) ctx.setze(ctx.banken, v.arbeitgeber, await findeOrganisation(c, v.arbeitgeber));
    delta.bank.orgId = ctx.banken.get(v.arbeitgeber) ?? null;
  }

  // Fall ueber kuba_herkunft vorab zugeordnet -> Person ist der Kontakt dieses Falls
  let fall: KubaFall | null = u.reserviert ? await ladeFall(c, u.reserviert.id) : null;
  let kontakt: KubaKontakt;
  if (fall) {
    kontakt = ctx.jeId.get(fall.kontaktId) ?? { id: fall.kontaktId, nachname: v.nachname ?? '', vorname: v.vorname, geburtsdatum: null, organisationId: null };
    if (!ctx.kontakteNeu.has(kontakt.id)) ctx.fuege(ctx.kontakteGematcht, kontakt.id);
  } else {
    kontakt = await findeOderLegePersonAn(c, v, erp, ctx, delta, u);
  }
  const fehlt = { organisationId: kontakt.organisationId ? null : delta.bank.orgId, geburtsdatum: kontakt.geburtsdatum ? null : v.geburtsdatum };
  if ((fehlt.organisationId || fehlt.geburtsdatum) && (await ergaenzeKontakt(c, kontakt.id, fehlt)).length) ctx.ergaenzt(kontakt, fehlt);

  if (!fall) {
    const offen = (await ladeFaelle(c, kontakt.id, profil)).filter((f) => !ctx.belegt.has(f.id) && !u.gesperrt.has(f.id));
    // ohne widerspruechliche Runs (z. B. Homepage-Anmeldung ohne Runs); sonst nur, wenn eindeutig (eine Zeile, ein Fall)
    fall = offen.find((f) => !widerspricht(f.runs, erp.runs)) ?? (u.einzig && offen.length === 1 ? offen[0] : null);
  }
  if (fall) ctx.fuege(ctx.belegt, fall.id);

  // Experten (nur muendliche Runs): Referent per Anzeigename, sonst Kontakt + externer Referent "aus KUBA"
  const experte = async (name: string | null): Promise<string | null> => {
    if (!name) return null;
    const key = normalisiereNamensteil(name);
    let id = ctx.experten.get(key);
    if (id) { if (!ctx.expertenNeu.has(id)) ctx.fuege(ctx.expertenGematcht, id); return id; }
    id = await legeExpertenAn(c, name);
    ctx.setze(ctx.experten, key, id);
    ctx.fuege(ctx.expertenNeu, id);
    return id;
  };
  const runs: KubaFallRun[] = [];
  for (const r of erp.runs) {
    runs.push({
      art: r.art, teil: r.teil, run: r.run, datum: r.datum, bestanden: r.bestanden, resultatProzent: r.resultatProzent, score: r.score,
      ort: r.ort, remote: r.remote, experte1Id: await experte(r.experte1), experte2Id: await experte(r.experte2),
    });
  }

  // Status (nur vorwaerts) und Zertifikat
  let status = fall ? statusVorwaerts(fall.status, erp.status) : erp.status;
  let zertifizierungId = fall?.zertifizierungId ?? null;
  if (status === 'zertifiziert' && erp.zertifikat) {
    if (zertifizierungId) delta.zertVorhanden++;
    else {
      const z = await findeZertifizierung(c, kontakt.id, erp.zertifikat.ausgestelltAm);
      if (z && z.profil && z.profil !== profil) {
        u.log('zertifikatStart', `Zertifikat nicht angelegt: dieselbe Person hat bereits ein SAQ-Zertifikat ${z.profil} vom ${erp.zertifikat.ausgestelltAm} (zertifizierung eindeutig je Person/Typ/Datum) – Status bestanden`, 'fehler');
        status = fall ? statusVorwaerts(fall.status, 'bestanden') : 'bestanden';
      } else if (z) {
        zertifizierungId = z.id;
        delta.zertVorhanden++;
      } else {
        zertifizierungId = await legeZertifizierungAn(c, { kontaktId: kontakt.id, profil, sprache: erp.sprache, ...erp.zertifikat, stichtag: u.stichtag });
        delta.zertNeu++;
      }
    }
  }

  if (!fall) {
    const bemerkung = ['Historischer Import aus Reporting KUBA']
      .concat(v.arbeitgeber && !delta.bank.orgId ? [`Arbeitgeber laut KUBA: «${v.arbeitgeber}» (keine CRM-Organisation zugeordnet)`] : [])
      .join(' · ');
    const id = await legeFallAn(c, {
      kontaktId: kontakt.id, organisationId: delta.bank.orgId, profil, sprache: erp.sprache, rolle: v.rolle, kennzeichnung: erp.kennzeichnung,
      status, kubaHerkunft: herkunft, bemerkung, zertifizierungId,
    });
    for (const r of runs) await legeRunAn(c, id, r);
    delta.runs.neu = runs.length;
    await protokolliereFall(c, id, { herkunft, status, runs: runs.length, zertifikat: Boolean(zertifizierungId) });
    return delta;
  }

  // Bestehender Fall: nur Luecken ergaenzen
  delta.ergebnis = 'vorhanden';
  const patch: KubaFallPatch = {};
  if (fall.kubaHerkunft !== herkunft) patch.kubaHerkunft = herkunft;
  if (!fall.organisationId && delta.bank.orgId) patch.organisationId = delta.bank.orgId;
  if (!fall.rolle && v.rolle) patch.rolle = v.rolle;
  if (!fall.kennzeichnung && erp.kennzeichnung) patch.kennzeichnung = erp.kennzeichnung;
  if (status !== fall.status) patch.status = status;
  if (zertifizierungId !== fall.zertifizierungId) patch.zertifizierungId = zertifizierungId;
  const bestehend = new Map(fall.runs.map((r) => [runSchluessel(r), r]));
  for (const r of runs) {
    const e = bestehend.get(runSchluessel(r));
    if (!e) { await legeRunAn(c, fall.id, r); delta.runs.neu++; continue; }
    if (e.datum !== r.datum || (e.bestanden !== null && r.bestanden !== null && e.bestanden !== r.bestanden)) {
      u.log(runFeld(r.art, r.teil, r.run, 'date'), `${kuerzel(r)} weicht vom ERP ab (ERP ${e.datum} ${e.bestanden ?? 'offen'}, KUBA ${r.datum} ${r.bestanden ?? 'offen'}) – ERP-Wert bleibt, nicht ueberschrieben`);
      delta.runs.vorhanden++;
      continue;
    }
    const luecken: KubaRunErgaenzung = {};
    for (const k of ['bestanden', 'resultatProzent', 'score', 'ort', 'experte1Id', 'experte2Id'] as const) {
      if (e[k] === null && r[k] !== null) (luecken as any)[k] = r[k];
    }
    if (luecken.ort && r.remote && !e.remote) luecken.remote = true;
    if (Object.keys(luecken).length) { await ergaenzeRun(c, fall.id, r, luecken); delta.runs.ergaenzt++; } else delta.runs.vorhanden++;
  }
  if (Object.keys(patch).length || delta.runs.neu || delta.runs.ergaenzt) {
    await aktualisiereFall(c, fall.id, patch);
    await protokolliereFall(c, fall.id, { herkunft, geaendert: Object.keys(patch), statusVorher: fall.status, status, runsNeu: delta.runs.neu, runsErgaenzt: delta.runs.ergaenzt });
  }
  return delta;
}

/**
 * Person zum Vorgang: mit Geburtsdatum genau Name + Geburtsdatum; ohne Geburtsdatum nur ein eindeutiger Kontakt
 * gleichen Namens ohne Geburtsdatum. Sonst neuer Kontakt; existiert ein gleichnamiger Kontakt, der wegen fehlendem
 * Geburtsdatum nicht sicher zuzuordnen ist, gibt es einen Hinweis (moegliche Dublette, manuell pruefen).
 */
async function findeOderLegePersonAn(c: pg.PoolClient, v: KubaVorgang, erp: ErpAbbildung, ctx: Kontext, delta: Delta, u: Umgebung): Promise<KubaKontakt> {
  const name = nameKey(v.nachname, v.vorname);
  const gleichnamig = ctx.jeName.get(name) ?? [];
  const treffer = v.geburtsdatum
    ? ctx.jeSchluessel.get(`${name}|${v.geburtsdatum}`)?.[0]
    : (() => { const ohne = gleichnamig.filter((k) => !k.geburtsdatum); return ohne.length === 1 ? ohne[0] : undefined; })();
  if (treffer) {
    if (!ctx.kontakteNeu.has(treffer.id)) ctx.fuege(ctx.kontakteGematcht, treffer.id);
    return treffer;
  }
  const unsicher = gleichnamig.filter((k) => !ctx.kontakteNeu.has(k.id) && (v.geburtsdatum ? !k.geburtsdatum : true));
  if (unsicher.length) {
    delta.moeglicheDublette = true;
    u.log(v.geburtsdatum ? 'nachname' : 'geburtsdatum', v.geburtsdatum
      ? `Kontakt mit gleichem Namen ohne Geburtsdatum im CRM vorhanden – nicht sicher zuzuordnen, neuer Kontakt angelegt (Dublette pruefen)`
      : `Geburtsdatum fehlt und gleichnamige Kontakte sind nicht eindeutig – neuer Kontakt angelegt (Dublette pruefen)`);
  }
  const k = await legeTeilnehmendeAn(c, {
    nachname: v.nachname ?? v.vorname ?? '', vorname: v.nachname ? v.vorname : null, geburtsdatum: v.geburtsdatum,
    organisationId: delta.bank.orgId, sprache: erp.sprache, herkunft: v.herkunft[0],
  });
  ctx.indexiere(k);
  ctx.fuege(ctx.kontakteNeu, k.id);
  return k;
}

function statusTabelle(vorgaenge: KubaVorgang[], erp: { profil: string; status: SaqStatus; anzahl: number }[]): KubaBericht['statusJeProfil'] {
  const profile = [...SAQ_PROFILE, ...(vorgaenge.some((v) => !v.profil) ? ['unbekannt'] : [])];
  return profile
    .map((profil) => ({
      profil,
      kuba: Object.fromEntries(KUBA_STATUS.map((s) => [s, vorgaenge.filter((v) => (v.profil ?? 'unbekannt') === profil && v.status === s).length])) as Record<KubaStatus, number>,
      erp: Object.fromEntries(SAQ_STATUS.map((s) => [s, erp.find((e) => e.profil === profil && e.status === s)?.anzahl ?? 0])) as Record<SaqStatus, number>,
    }))
    .filter((z) => Object.values(z.kuba).some(Boolean) || Object.values(z.erp).some(Boolean));
}

// ---------------------------------------------------------------- Bericht

const zelle = (s: unknown) => String(s ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');

export function berichtMarkdown(b: KubaBericht): string {
  const z: string[] = [`# KUBA-Import ${b.probelauf ? '(PROBELAUF – nichts gespeichert)' : '(ausgefuehrt)'}`, ''];
  z.push(`Datei: ${b.datei ?? '–'} · Stichtag: ${b.stichtag}`, '');
  z.push('## Zaehler', '', '| Sheet | Zeilen mit Inhalt |', '|---|---|');
  z.push(`| First Certification | ${b.zeilen.first} |`, `| Ausgestellte Zertifikate | ${b.zeilen.issued} |`, '');
  z.push('| Kennzahl | Anzahl |', '|---|---|');
  const zeilen: [string, number | string][] = [
    ['Zeilen ohne Namen (nicht uebernommen)', b.ohneName],
    ['Vorgaenge (Person x Profil, nach Zusammenfuehrung)', b.vorgaenge],
    ['Duplikate zusammengefuehrt', b.duplikate],
    ['Profilkonflikte (gleiche Person/Profil, abweichende Pruefungsdaten -> eigener Vorgang)', b.profilKonflikte],
    ['SAQ-Faelle neu', b.faelle.neu],
    ['SAQ-Faelle vorhanden (ergaenzt)', b.faelle.vorhanden],
    ['Vorgaenge nicht importierbar', b.nichtImportiert.length],
    ['Vorgaenge mit Fehler beim Import', b.faelle.fehler],
    ['Personen neu angelegt', b.personen.neu],
    ['Personen im CRM gefunden', b.personen.gematcht],
    ['Vorgaenge ohne Geburtsdatum (Abgleich nur ueber Namen)', b.personen.ohneGeburtsdatum],
    ['Moegliche Dubletten (gleichnamiger Kontakt nicht sicher zuzuordnen)', b.personen.moeglicheDubletten],
    ['Banken zugeordnet (Organisationen / Vorgaenge)', `${b.organisationen.zugeordnet.organisationen} / ${b.organisationen.zugeordnet.vorgaenge}`],
    ['Banken nicht zugeordnet (Namen / Vorgaenge)', `${b.organisationen.nichtZugeordnet.length} / ${b.organisationen.nichtZugeordnet.reduce((s, x) => s + x.vorgaenge, 0)}`],
    ['Vorgaenge ohne Arbeitgeber', b.organisationen.ohneArbeitgeber],
    ['Runs neu / ergaenzt / unveraendert', `${b.runs.neu} / ${b.runs.ergaenzt} / ${b.runs.vorhanden}`],
    ['Zertifikate neu / vorhanden', `${b.zertifikate.neu} / ${b.zertifikate.vorhanden}`],
    ['Experten neu / gefunden', `${b.experten.neu} / ${b.experten.gematcht}`],
    ['Data-Quality-Eintraege (Fehler / Hinweise / nicht ausgewertet)', ['fehler', 'hinweis', 'nicht-ausgewertet'].map((s) => b.dq.filter((d) => d.stufe === s).length).join(' / ')],
  ];
  for (const [k, n] of zeilen) z.push(`| ${k} | ${n} |`);
  z.push('');

  z.push('## Status je Profil (Abgleich mit dem Cockpit bbz-saq)', '',
    'KUBA = Status laut Datei wie im Cockpit (Gesamtergebnis WE All / OE All); ERP = saq_fall.status aller Faelle mit KUBA-Herkunft.', '',
    `| Profil | ${KUBA_STATUS.map((s) => `KUBA ${s}`).join(' | ')} | ${SAQ_STATUS.map((s) => `ERP ${s}`).join(' | ')} |`,
    `|---|${KUBA_STATUS.map(() => '---').join('|')}|${SAQ_STATUS.map(() => '---').join('|')}|`);
  for (const p of b.statusJeProfil) z.push(`| ${p.profil} | ${KUBA_STATUS.map((s) => p.kuba[s]).join(' | ')} | ${SAQ_STATUS.map((s) => p.erp[s]).join(' | ')} |`);
  z.push('');

  if (b.organisationen.nichtZugeordnet.length) {
    z.push('## Banken ohne CRM-Organisation', '', 'Werden nicht automatisch angelegt. Organisation im CRM erfassen (oder Alias in src/config/bankAliase.ts ergaenzen) und den Import erneut ausfuehren; der Name steht bis dahin in saq_fall.bemerkung.', '',
      '| Employer (KUBA) | Vorgaenge |', '|---|---|');
    for (const o of b.organisationen.nichtZugeordnet) z.push(`| ${zelle(o.name)}${o.kanon ? ` (${zelle(o.kanon)})` : ''} | ${o.vorgaenge} |`);
    z.push('');
  }
  if (b.nichtImportiert.length || b.fehler.length) {
    z.push('## Nicht importierte Vorgaenge', '', '| Herkunft | Grund |', '|---|---|');
    for (const f of [...b.nichtImportiert, ...b.fehler]) z.push(`| ${zelle(f.herkunft)} | ${zelle(f.grund)} |`);
    z.push('');
  }
  z.push('## Data-Quality-Log', '', 'fehler = Zelle nicht interpretierbar (Wert ignoriert) · hinweis = interpretiert, abgeleitet oder auffaellig · nicht-ausgewertet = Feld fliesst nicht ein (Score).', '',
    '| Sheet | Zeile | Header | Rohwert | Stufe | Grund |', '|---|---|---|---|---|---|');
  for (const d of b.dq) z.push(`| ${zelle(d.sheet)} | ${d.zeile} | ${zelle(d.header)} | ${zelle(d.roh)} | ${d.stufe} | ${zelle(d.grund)} |`);
  return z.join('\n') + '\n';
}
