// Reine SAQ-Regeln (DB-frei): Normalisierung, Teilpruefungen/Runs, Status, Zulassung, Kennzahlen, KUBA-Export.
// Begriffe und Definitionen wie im Cockpit bbz-saq (config.js, glossary.js), damit ERP und KUBA dasselbe meinen.
import { SAQ, SAQ_PROFILE, SAQ_PROFIL_ALIASE, SAQ_TEILE, SAQ_PASSERELLE } from '../config/saq';
import { ValidationError, ConflictError } from './errors';
import type {
  SaqProfil, SaqSprache, SaqUmfang, SaqVariante, SaqStatus, SaqPruefungArt, SaqRun, SaqTeil, SaqUebersicht,
  MuendlichZulassung, SaqQuote, SaqMittel, SaqKennzahlZeile, SaqKennzahlen, KubaZeile,
} from './saqTypes';

export const SAQ_STATUS: SaqStatus[] = ['angemeldet', 'in_pruefung', 'schriftlich_bestanden', 'bestanden', 'zertifiziert', 'nicht_bestanden', 'abgebrochen'];
const OFFENE_STATUS: SaqStatus[] = ['angemeldet', 'in_pruefung', 'schriftlich_bestanden'];
const ARTEN: SaqPruefungArt[] = ['schriftlich', 'muendlich'];
const kuerzel = (art: SaqPruefungArt) => (art === 'schriftlich' ? 'WE' : 'OE');

// ---------------------------------------------------------------- Datum (YYYY-MM-DD, zeitzonenfrei)

export function istIsoDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function pruefeDatum(s: unknown, feld: string): string {
  if (!istIsoDatum(s)) throw new ValidationError(`${feld} muss ein Datum YYYY-MM-DD sein`);
  return s;
}

/** Heutiges Datum in Zuerich (Geschaeftstag), unabhaengig von der Server-Zeitzone. */
export function heute(jetzt: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(jetzt);
}

const tageZwischen = (von: string, bis: string) =>
  Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);

// ---------------------------------------------------------------- Normalisierung / Whitelists

export function normalisiereProfil(v: unknown): SaqProfil {
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError('profil ist Pflicht');
  const roh = v.trim().toUpperCase();
  const p = SAQ_PROFILE.find((x) => x.toUpperCase() === roh) ?? SAQ_PROFIL_ALIASE[roh];
  if (!p) throw new ValidationError(`Unbekanntes Profil: ${v} (erlaubt: ${SAQ_PROFILE.join(', ')})`);
  return p;
}

export function normalisiereSprache(v: unknown): SaqSprache {
  if (v === undefined || v === null || v === '') return 'DE';
  const roh = String(v).trim().toUpperCase();
  const s = (SAQ.sprachen as string[]).includes(roh) ? (roh as SaqSprache) : SAQ.spracheAliase[roh];
  if (!s) throw new ValidationError(`Unbekannte Sprache: ${v} (erlaubt: ${SAQ.sprachen.join(', ')})`);
  return s;
}

export function normalisiereUmfang(v: unknown): SaqUmfang {
  if (v === undefined || v === null || v === '') return 'gesamtpaket';
  const roh = String(v).trim().toLowerCase();
  if (!(SAQ.umfaenge as string[]).includes(roh)) throw new ValidationError(`Unbekannter Umfang: ${v} (erlaubt: ${SAQ.umfaenge.join(', ')})`);
  return roh as SaqUmfang;
}

export function normalisiereVariante(v: unknown): SaqVariante {
  if (v === undefined || v === null || v === '') return 'erstzertifizierung';
  const roh = String(v).trim().toLowerCase();
  if (!(SAQ.varianten as string[]).includes(roh)) throw new ValidationError(`Unbekannte Variante: ${v} (erlaubt: ${SAQ.varianten.join(', ')})`);
  return roh as SaqVariante;
}

/** Passerelle setzt ein Vorgaengerprofil voraus (IK<-PK, CWMA<-AFFL, CCoB<-KMU). */
export function pruefeVariante(profil: SaqProfil, variante: SaqVariante): void {
  if (variante === 'passerelle' && !SAQ_PASSERELLE[profil]) {
    throw new ValidationError(`Passerelle gibt es nur fuer ${Object.keys(SAQ_PASSERELLE).join(', ')} (nicht ${profil})`);
  }
}

// ---------------------------------------------------------------- Teilpruefungen, Runs, Status

/** Pflicht-Teilpruefungen; bei Passerelle genuegt ein schriftlicher Teil (WE1, [Hypothese] siehe config). */
export function pflichtteile(profil: SaqProfil, variante: SaqVariante): { schriftlich: number[]; muendlich: number[] } {
  const t = SAQ_TEILE[profil];
  return { schriftlich: variante === 'passerelle' ? [1] : [...t.schriftlich], muendlich: [...t.muendlich] };
}

/** Pruefungsarten, die der gebuchte Umfang enthaelt. */
export function umfangArten(umfang: SaqUmfang): SaqPruefungArt[] {
  if (umfang === 'gesamtpaket') return ['schriftlich', 'muendlich'];
  if (umfang === 'schriftlich' || umfang === 'muendlich') return [umfang];
  return [];
}

/** Ein Run gilt ab 70 % als bestanden (>= 70, Auftraggeber 10.09.2026; Website: "> 70 %", siehe config). */
export function bestandenAusResultat(prozent: number): boolean {
  return prozent >= SAQ.bestehensgrenzeProzent;
}

function zahlOderNull(v: unknown, feld: string, min?: number, max?: number): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n)) throw new ValidationError(`${feld} muss eine Zahl sein`);
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) throw new ValidationError(`${feld} muss zwischen ${min} und ${max} liegen`);
  return n;
}

/**
 * Wertet ein Resultat aus. `bestanden` ist massgebend (KUBA "Passed"); fehlt es, wird es aus dem Resultat abgeleitet.
 * Widersprechen sich beide, wird der Wert uebernommen und eine Warnung geliefert (Data-Quality-Hinweis wie bbz-saq).
 */
export function werteResultat(input: { resultatProzent?: unknown; score?: unknown; bestanden?: unknown }): {
  resultatProzent: number | null; score: number | null; bestanden: boolean; warnungen: string[];
} {
  const resultatProzent = zahlOderNull(input.resultatProzent, 'resultatProzent', 0, 100);
  const score = zahlOderNull(input.score, 'score', 0, 9999);
  if (input.bestanden !== undefined && input.bestanden !== null && typeof input.bestanden !== 'boolean') {
    throw new ValidationError('bestanden muss true oder false sein');
  }
  const gemeldet = typeof input.bestanden === 'boolean' ? input.bestanden : null;
  if (gemeldet === null && resultatProzent === null) throw new ValidationError('bestanden oder resultatProzent ist Pflicht');
  const warnungen: string[] = [];
  if (gemeldet !== null && resultatProzent !== null && gemeldet !== bestandenAusResultat(resultatProzent)) {
    warnungen.push(`bestanden=${gemeldet} widerspricht Resultat ${resultatProzent} % (Grenze ab ${SAQ.bestehensgrenzeProzent} %)`);
  }
  return { resultatProzent, score, bestanden: gemeldet ?? bestandenAusResultat(resultatProzent as number), warnungen };
}

function teilStatus(art: SaqPruefungArt, teil: number, runs: SaqRun[]): SaqTeil {
  const eigene = runs.filter((r) => r.art === art && r.teil === teil);
  const absolviert = eigene.filter((r) => r.bestanden !== null);
  const status = absolviert.some((r) => r.bestanden)
    ? 'bestanden'
    : absolviert.length >= SAQ.maxRuns ? 'endgueltig_nicht_bestanden' : 'offen';
  return { art, teil, status, versuche: absolviert.length, geplant: eigene.some((r) => r.bestanden === null) };
}

/** Stand je Pflicht-Teilpruefung (nur Arten im gebuchten Umfang) und Gesamtaussagen. */
export function uebersicht(fall: { profil: SaqProfil; variante: SaqVariante; umfang: SaqUmfang }, runs: SaqRun[]): SaqUebersicht {
  const pflicht = pflichtteile(fall.profil, fall.variante);
  const alle = (art: SaqPruefungArt) => pflicht[art].map((t) => teilStatus(art, t, runs));
  const schriftlich = alle('schriftlich');
  const muendlich = alle('muendlich');
  const imUmfang = umfangArten(fall.umfang);
  const teile = [...schriftlich, ...muendlich].filter((t) => imUmfang.includes(t.art));
  return {
    pflichtteile: pflicht,
    teile,
    schriftlichAlleBestanden: schriftlich.every((t) => t.status === 'bestanden'),
    muendlichAlleBestanden: muendlich.every((t) => t.status === 'bestanden'),
    endgueltigNichtBestanden: [...schriftlich, ...muendlich].some((t) => t.status === 'endgueltig_nicht_bestanden'),
  };
}

/**
 * Automatischer Status eines offenen Falls aus seinen Runs: endgueltig nicht bestandener Teil -> nicht_bestanden;
 * muendlich (und schriftlich) bestanden -> bestanden; schriftlich alle Teile -> schriftlich_bestanden;
 * irgendein Run -> in_pruefung; sonst angemeldet. Umfang "muendlich": schriftlich gilt als extern bestanden.
 */
export function berechneStatus(fall: { profil: SaqProfil; variante: SaqVariante; umfang: SaqUmfang }, runs: SaqRun[]): SaqStatus {
  const u = uebersicht(fall, runs);
  if (u.endgueltigNichtBestanden) return 'nicht_bestanden';
  const schriftlichOk = u.schriftlichAlleBestanden || fall.umfang === 'muendlich';
  if (schriftlichOk && u.muendlichAlleBestanden && umfangArten(fall.umfang).includes('muendlich')) return 'bestanden';
  if (u.schriftlichAlleBestanden) return 'schriftlich_bestanden';
  return runs.length ? 'in_pruefung' : 'angemeldet';
}

export function istOffen(status: SaqStatus): boolean {
  return OFFENE_STATUS.includes(status);
}

/**
 * Zulassung zur muendlichen Pruefung: alle schriftlichen Pflichtteile bestanden UND Arbeitgeberbestaetigung.
 * Ausnahme Umfang "muendlich": die schriftliche Pruefung gilt als anderweitig bestanden [Annahme]; die
 * Arbeitgeberbestaetigung bleibt Pflicht ("ohne sie keine Zulassung zur muendlichen Pruefung", Website §2.2 A).
 */
export function muendlichZulassung(fall: { umfang: SaqUmfang; arbeitgeberbestaetigungAm: string | null }, schriftlichAlleBestanden: boolean): MuendlichZulassung {
  const gruende: string[] = [];
  if (!umfangArten(fall.umfang).includes('muendlich')) gruende.push(`Umfang ${fall.umfang} umfasst keine muendliche Pruefung`);
  else if (fall.umfang !== 'muendlich' && !schriftlichAlleBestanden) gruende.push('Schriftliche Pruefung (alle Pflichtteile) noch nicht bestanden');
  if (!fall.arbeitgeberbestaetigungAm) gruende.push('Arbeitgeberbestaetigung fehlt');
  return { zugelassen: gruende.length === 0, gruende };
}

type FallRegeln = { status: SaqStatus; profil: SaqProfil; variante: SaqVariante; umfang: SaqUmfang; arbeitgeberbestaetigungAm: string | null };

function pruefeMuendlich(fall: FallRegeln, runs: SaqRun[]): void {
  const z = muendlichZulassung(fall, uebersicht(fall, runs).schriftlichAlleBestanden);
  if (!z.zugelassen) throw new ConflictError(`Keine Zulassung zur muendlichen Pruefung: ${z.gruende.join('; ')}`);
}

/**
 * Prueft, ob fuer Teil `teil` der Art `art` ein weiterer Run geplant werden darf, und liefert dessen Nummer (max + 1).
 * Regeln: offener Fall, Art im Umfang, Teil gemaess Profil, Experten nur muendlich, Teil nicht bestanden,
 * vorheriger Run abgeschlossen (nicht bestanden), hoechstens 3 Runs, muendlich nur mit Zulassung.
 */
export function pruefeEinplanung(fall: FallRegeln, runs: SaqRun[], art: SaqPruefungArt, teil: number, mitExperten: boolean): number {
  if (!istOffen(fall.status)) throw new ConflictError(`Fall im Status ${fall.status}: keine Pruefung planbar`);
  if (!ARTEN.includes(art)) throw new ValidationError(`art muss ${ARTEN.join(' oder ')} sein`);
  if (!Number.isInteger(teil)) throw new ValidationError('teil muss eine ganze Zahl sein');
  if (!umfangArten(fall.umfang).includes(art)) throw new ConflictError(`Umfang ${fall.umfang} umfasst keine ${art}e Pruefung`);
  if (!pflichtteile(fall.profil, fall.variante)[art].includes(teil)) {
    throw new ValidationError(`Teil ${kuerzel(art)}${teil} ist fuer Profil ${fall.profil} (${fall.variante}) nicht vorgesehen`);
  }
  if (mitExperten && art !== 'muendlich') throw new ValidationError('Experten gibt es nur bei muendlichen Pruefungen');
  const eigene = runs.filter((r) => r.art === art && r.teil === teil).sort((a, b) => a.run - b.run);
  if (eigene.some((r) => r.bestanden === true)) throw new ConflictError(`${kuerzel(art)}${teil} ist bereits bestanden`);
  const offen = eigene.find((r) => r.bestanden === null);
  if (offen) throw new ConflictError(`${kuerzel(art)}${teil} RUN${offen.run} ist noch offen (Resultat fehlt)`);
  if (eigene.length >= SAQ.maxRuns) throw new ConflictError(`${kuerzel(art)}${teil}: hoechstens ${SAQ.maxRuns} Runs`);
  if (art === 'muendlich') pruefeMuendlich(fall, runs);
  return (eigene.at(-1)?.run ?? 0) + 1;
}

/** Ein Resultat wird genau einmal erfasst, nur in offenen Faellen, muendlich nur mit Zulassung (409). */
export function pruefeResultatErfassung(fall: FallRegeln, runs: SaqRun[], pruefung: SaqRun): void {
  if (pruefung.bestanden !== null) throw new ConflictError(`Resultat fuer ${kuerzel(pruefung.art)}${pruefung.teil} RUN${pruefung.run} ist bereits erfasst`);
  if (!istOffen(fall.status)) throw new ConflictError(`Fall im Status ${fall.status}: kein Resultat erfassbar`);
  if (pruefung.art === 'muendlich') pruefeMuendlich(fall, runs);
}

/**
 * Manuell setzbar sind nur nicht_bestanden und abgebrochen (aus offenen Faellen). Alle anderen Status ergeben sich
 * aus Resultaten bzw. dem Zertifikat. Abgeschlossene Faelle werden nicht wieder geoeffnet: eine Wiederaufnahme ist
 * ein neuer Fall mit Variante "wiederholung".
 */
export function pruefeManuellenStatuswechsel(von: SaqStatus, nach: unknown): SaqStatus {
  if (typeof nach !== 'string' || !(SAQ_STATUS as string[]).includes(nach)) throw new ValidationError(`Unbekannter Status: ${String(nach)}`);
  const ziel = nach as SaqStatus;
  if (ziel === von) return ziel;
  if (!istOffen(von) || (ziel !== 'nicht_bestanden' && ziel !== 'abgebrochen')) {
    throw new ConflictError(`Statuswechsel ${von} -> ${ziel} nicht erlaubt (nur offene Faelle -> nicht_bestanden/abgebrochen; uebrige Status folgen aus Resultaten und Zertifikat)`);
  }
  return ziel;
}

// ---------------------------------------------------------------- Passiv, Referenzdatum, Gueltigkeit

/** Datum des letzten absolvierten Runs (mit Ergebnis); null ohne Ergebnis. */
export function letztePruefung(runs: SaqRun[]): string | null {
  return runs.filter((r) => r.bestanden !== null).map((r) => r.datum).sort().at(-1) ?? null;
}

/** Geplanter Termin = Run ohne Ergebnis mit Datum am oder nach dem Stichtag (bbz-saq "Geplante Pruefung"). */
export function hatGeplantenRun(runs: SaqRun[], stichtag: string): boolean {
  return runs.some((r) => r.bestanden === null && r.datum >= stichtag);
}

/** "Passiver Vorgang": offen, letzte Pruefung > 365 Tage vor dem Stichtag, kein geplanter Termin; ohne Pruefung nie passiv. */
export function istPassiv(v: { status: SaqStatus; letztePruefung: string | null; geplant: boolean }, stichtag: string): boolean {
  return istOffen(v.status) && v.letztePruefung !== null && !v.geplant && tageZwischen(v.letztePruefung, stichtag) > SAQ.passivTage;
}

/** Referenzdatum (bbz-saq): Datum des bestandenen muendlichen Runs, sonst des letzten absolvierten Runs. */
export function referenzdatum(runs: SaqRun[]): string | null {
  return runs.filter((r) => r.art === 'muendlich' && r.bestanden === true).map((r) => r.datum).sort().at(-1) ?? letztePruefung(runs);
}

/** Gueltigkeit des Zertifikats: ausgestellt + 3 Jahre; 29.2. faellt auf den 28.2. */
export function gueltigBis(ausgestelltAm: string, jahre: number = SAQ.gueltigkeitJahre): string {
  pruefeDatum(ausgestelltAm, 'ausgestelltAm');
  const [y, m, d] = ausgestelltAm.split('-').map(Number);
  const letzterTag = new Date(Date.UTC(y + jahre, m, 0)).getUTCDate();
  return new Date(Date.UTC(y + jahre, m - 1, Math.min(d, letzterTag))).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- Kennzahlen

const eineStelle = (x: number) => Math.round(x * 10) / 10;

export function quote(zaehler: number, n: number): SaqQuote {
  return { quote: n ? eineStelle((zaehler / n) * 100) : null, zaehler, n };
}

function mittel(werte: number[]): SaqMittel {
  return { mittel: werte.length ? eineStelle(werte.reduce((s, x) => s + x, 0) / werte.length) : null, n: werte.length };
}

type KennzahlFall = { profil: SaqProfil; status: SaqStatus; runs: SaqRun[] };

function kennzahlZeile(faelle: KennzahlFall[]): SaqKennzahlZeile {
  const abgeschlossen = faelle.filter((f) => ['bestanden', 'zertifiziert', 'nicht_bestanden'].includes(f.status));
  const bestanden = abgeschlossen.filter((f) => f.status !== 'nicht_bestanden');
  const erstversuch = (art: SaqPruefungArt) => {
    const mitRun1 = faelle.map((f) => f.runs.filter((r) => r.art === art && r.run === 1 && r.bestanden !== null)).filter((rs) => rs.length);
    return quote(mitRun1.filter((rs) => rs.every((r) => r.bestanden)).length, mitRun1.length);
  };
  const resultat = (art: SaqPruefungArt) => mittel(faelle.flatMap((f) => {
    const werte = f.runs.filter((r) => r.art === art && r.run === 1 && r.bestanden !== null && r.resultatProzent !== null)
      .map((r) => r.resultatProzent as number);
    return werte.length ? [werte.reduce((s, x) => s + x, 0) / werte.length] : [];
  }));
  return {
    vorgaenge: faelle.length,
    abgeschlossen: abgeschlossen.length,
    bestanden: bestanden.length,
    quoteInsgesamt: quote(bestanden.length, abgeschlossen.length),
    erstversuchSchriftlich: erstversuch('schriftlich'),
    erstversuchMuendlich: erstversuch('muendlich'),
    resultatErstversuchSchriftlich: resultat('schriftlich'),
    resultatErstversuchMuendlich: resultat('muendlich'),
  };
}

/**
 * Kennzahlen eines Jahres (Ablösung "Reporting KUBA"). Ein Vorgang zaehlt im Jahr seines Referenzdatums; Vorgaenge
 * ohne absolvierten Run haben kein Referenzdatum und zaehlen nicht. Abgeschlossen = bestanden, zertifiziert oder
 * nicht_bestanden (Nenner der Quote insgesamt); abgebrochene und offene Vorgaenge stehen nicht im Nenner.
 */
export function kennzahlen(jahr: number, faelle: KennzahlFall[]): SaqKennzahlen {
  const imJahr = faelle.filter((f) => referenzdatum(f.runs)?.startsWith(`${jahr}-`));
  return {
    jahr,
    total: kennzahlZeile(imJahr),
    jeProfil: SAQ_PROFILE.map((profil) => ({ profil, ...kennzahlZeile(imJahr.filter((f) => f.profil === profil)) })),
  };
}

// ---------------------------------------------------------------- KUBA-Export (bbz-saq HEADER_FIELDS)

const KOPF = ['lastName', 'firstName', 'role', 'employer', 'profil', 'sprache', 'commLanguage', 'birthDate', 'certNumber', 'certStart', 'certEnd'];

/** Logische Feldschluessel in der Reihenfolge von bbz-saq config.js HEADER_FIELDS. */
export function kubaFeldschluessel(): string[] {
  const keys = [...KOPF];
  for (const [kind, raster] of [['we', SAQ.kuba.we], ['oe', SAQ.kuba.oe]] as const) {
    keys.push(`${kind}AllPassed`);
    for (let p = 1; p <= raster.teile; p++) {
      keys.push(`${kind}${p}.passed`);
      for (let r = 1; r <= raster.runs; r++) {
        for (const what of ['passed', 'date', 'score', 'result', 'location']) keys.push(`${kind}${p}.run${r}.${what}`);
        if (kind === 'oe') keys.push(`${kind}${p}.run${r}.expert1`, `${kind}${p}.run${r}.expert2`);
      }
    }
  }
  return keys;
}

const jaNein = (b: boolean | null | undefined) => (b === true ? 'yes' : b === false ? 'no' : '');

export type KubaRun = SaqRun & { score: number | null; ort: string | null; remote: boolean; experte1: string | null; experte2: string | null };

/**
 * Eine Vorgangszeile im bbz-saq-Format: Passed-Werte yes/no/leer, Resultat als Anteil 0-1, fehlende Werte leer.
 * "we{n}.passed"/"weAllPassed": yes = bestanden, no = (endgueltig bzw. zuletzt) nicht bestanden, leer = offen.
 */
export function kubaZeile(v: {
  fallId: string; nachname: string; vorname: string | null; rolle: string | null; organisationName: string | null;
  profil: SaqProfil; sprache: SaqSprache; kommunikationssprache: string | null; geburtsdatum: string | null;
  zertifikat: { zertifikatNr: string | null; ausgestelltAm: string; gueltigBis: string } | null;
  uebersicht: SaqUebersicht; runs: KubaRun[];
}): KubaZeile {
  const z: KubaZeile = {
    lastName: v.nachname, firstName: v.vorname ?? '', role: v.rolle ?? '', employer: v.organisationName ?? '',
    profil: v.profil, sprache: v.sprache, commLanguage: v.kommunikationssprache?.toUpperCase() ?? '', birthDate: v.geburtsdatum ?? '',
    certNumber: v.zertifikat?.zertifikatNr ?? '', certStart: v.zertifikat?.ausgestelltAm ?? '', certEnd: v.zertifikat?.gueltigBis ?? '',
  };
  for (const [kind, art, raster] of [['we', 'schriftlich', SAQ.kuba.we], ['oe', 'muendlich', SAQ.kuba.oe]] as const) {
    const teile = v.uebersicht.teile.filter((t) => t.art === art);
    const alle = art === 'schriftlich' ? v.uebersicht.schriftlichAlleBestanden : v.uebersicht.muendlichAlleBestanden;
    z[`${kind}AllPassed`] = teile.length && alle ? 'yes' : teile.some((t) => t.status === 'endgueltig_nicht_bestanden') ? 'no' : '';
    for (let p = 1; p <= raster.teile; p++) {
      const eigene = v.runs.filter((r) => r.art === art && r.teil === p);
      const absolviert = eigene.filter((r) => r.bestanden !== null);
      z[`${kind}${p}.passed`] = absolviert.some((r) => r.bestanden) ? 'yes' : absolviert.length ? 'no' : '';
      for (let r = 1; r <= raster.runs; r++) {
        const x = eigene.find((e) => e.run === r);
        const k = `${kind}${p}.run${r}`;
        z[`${k}.passed`] = jaNein(x?.bestanden);
        z[`${k}.date`] = x?.datum ?? '';
        z[`${k}.score`] = x?.score ?? '';
        z[`${k}.result`] = x?.resultatProzent != null ? Math.round(x.resultatProzent * 100) / 10000 : '';
        z[`${k}.location`] = x ? (x.ort ?? (x.remote ? 'Remote' : '')) : '';
        if (kind === 'oe') {
          z[`${k}.expert1`] = x?.experte1 ?? '';
          z[`${k}.expert2`] = x?.experte2 ?? '';
        }
      }
    }
  }
  z.erpFallId = v.fallId;
  return z;
}
