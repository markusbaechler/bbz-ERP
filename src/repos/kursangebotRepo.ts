import type {
  Kursangebot, KursFormat, OeffentlicherKurs, OeffentlicheDurchfuehrung,
} from '../domain/bildungTypes';
import { KURS_FORMATE, AKTIVE_ANMELDESTATUS } from '../domain/bildungTypes';
import { slugify, heuteIso, zeitKurz } from '../domain/kursplanung';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { type Db, patchSets, num } from './db';

export const mapKursangebot = (r: any): Kursangebot => ({
  id: r.id, code: r.code, titel: r.titel, untertitel: r.untertitel, bereich: r.bereich, format: r.format,
  beschreibung: r.beschreibung, lernziele: r.lernziele, zielgruppe: r.zielgruppe, voraussetzungen: r.voraussetzungen,
  dauerTage: num(r.dauer_tage), lernstunden: num(r.lernstunden), preisChf: num(r.preis_chf), mwstSatz: Number(r.mwst_satz),
  ertragskontoId: r.ertragskonto_id, saqAnerkannt: r.saq_anerkannt, moodleVorlageKursId: r.moodle_vorlage_kurs_id,
  oeffentlich: r.oeffentlich, slug: r.slug, aktiv: r.aktiv,
});

export type KursangebotInput = {
  code: string; titel: string; bereich: string; untertitel?: string | null; format?: KursFormat;
  beschreibung?: string | null; lernziele?: string | null; zielgruppe?: string | null; voraussetzungen?: string | null;
  dauerTage?: number | null; lernstunden?: number | null; preisChf?: number | null; mwstSatz?: number;
  ertragskontoId?: string | null; saqAnerkannt?: boolean; moodleVorlageKursId?: number | null;
  oeffentlich?: boolean; slug?: string | null; aktiv?: boolean;
};

const COLS: Record<string, string> = {
  code: 'code', titel: 'titel', untertitel: 'untertitel', bereich: 'bereich', format: 'format', beschreibung: 'beschreibung',
  lernziele: 'lernziele', zielgruppe: 'zielgruppe', voraussetzungen: 'voraussetzungen', dauerTage: 'dauer_tage',
  lernstunden: 'lernstunden', preisChf: 'preis_chf', mwstSatz: 'mwst_satz', ertragskontoId: 'ertragskonto_id',
  saqAnerkannt: 'saq_anerkannt', moodleVorlageKursId: 'moodle_vorlage_kurs_id', oeffentlich: 'oeffentlich', slug: 'slug',
  aktiv: 'aktiv',
};

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function normalisiere(input: Partial<KursangebotInput>): Partial<KursangebotInput> {
  const out = { ...input };
  if ('code' in input) {
    const c = input.code?.trim() ?? '';
    if (!CODE_RE.test(c)) throw new ValidationError('code ist Pflicht (Buchstaben, Ziffern, - und _)');
    out.code = c;
  }
  for (const f of ['titel', 'bereich'] as const) {
    if (f in input) {
      if (!input[f]?.trim()) throw new ValidationError(`${f} ist Pflicht`);
      out[f] = input[f]!.trim();
    }
  }
  if (input.format !== undefined && !KURS_FORMATE.includes(input.format)) {
    throw new ValidationError(`format muss ${KURS_FORMATE.join('/')} sein`);
  }
  for (const f of ['dauerTage', 'lernstunden', 'preisChf'] as const) {
    const v = input[f];
    if (v !== undefined && v !== null && !(typeof v === 'number' && v >= 0)) throw new ValidationError(`${f} muss >= 0 sein`);
  }
  if (input.mwstSatz !== undefined && !(typeof input.mwstSatz === 'number' && input.mwstSatz >= 0 && input.mwstSatz <= 100)) {
    throw new ValidationError('mwstSatz muss zwischen 0 und 100 liegen');
  }
  return out;
}

function alsKonflikt(e: any): never {
  if (e?.code === '23505') {
    const c = String(e.constraint ?? '');
    if (c.includes('code')) throw new ConflictError('Ein Kursangebot mit diesem Code existiert bereits');
    if (c.includes('slug')) throw new ConflictError('Ein Kursangebot mit diesem Slug existiert bereits');
  }
  throw e;
}

/** Freier Slug zum Basis-Slug: "titel", sonst "titel-2", "titel-3" ... */
async function freierSlug(db: Db, basis: string, ausserId: string | null = null): Promise<string> {
  const r = await db.query(
    `select slug from kursangebot where (slug = $1 or slug like $1 || '-%') and id is distinct from $2`, [basis, ausserId]);
  const belegt = new Set(r.rows.map((x: any) => x.slug));
  if (!belegt.has(basis)) return basis;
  let n = 2;
  while (belegt.has(`${basis}-${n}`)) n += 1;
  return `${basis}-${n}`;
}

function expliziterSlug(s: string): string {
  const slug = slugify(s);
  if (!slug) throw new ValidationError('slug ist leer');
  return slug;
}

export async function createKursangebot(db: Db, input: KursangebotInput): Promise<Kursangebot> {
  const n = normalisiere({ ...input, code: input.code ?? '', titel: input.titel ?? '', bereich: input.bereich ?? '' });
  // Expliziter Slug muss frei sein (409), automatischer Slug aus dem Titel wird bei Kollision nummeriert.
  const slug = n.slug ? expliziterSlug(n.slug) : await freierSlug(db, slugify(n.titel!) || slugify(n.code!));
  const r = await db.query(
    `insert into kursangebot(code,titel,untertitel,bereich,format,beschreibung,lernziele,zielgruppe,voraussetzungen,dauer_tage,
       lernstunden,preis_chf,mwst_satz,ertragskonto_id,saq_anerkannt,moodle_vorlage_kurs_id,oeffentlich,slug,aktiv)
     values ($1,$2,$3,$4,coalesce($5,'praesenz'),$6,$7,$8,$9,$10,$11,$12,coalesce($13,0),$14,coalesce($15,false),$16,coalesce($17,false),$18,coalesce($19,true))
     returning *`,
    [n.code, n.titel, n.untertitel ?? null, n.bereich, n.format ?? null, n.beschreibung ?? null, n.lernziele ?? null,
     n.zielgruppe ?? null, n.voraussetzungen ?? null, n.dauerTage ?? null, n.lernstunden ?? null, n.preisChf ?? null,
     n.mwstSatz ?? null, n.ertragskontoId ?? null, n.saqAnerkannt ?? null, n.moodleVorlageKursId ?? null,
     n.oeffentlich ?? null, slug, n.aktiv ?? null],
  ).catch(alsKonflikt);
  return mapKursangebot(r.rows[0]);
}

export async function getKursangebot(db: Db, id: string): Promise<Kursangebot> {
  const r = await db.query('select * from kursangebot where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Kursangebot ${id} nicht gefunden`);
  return mapKursangebot(r.rows[0]);
}

/** Der Slug bleibt bei Titelaenderungen stabil (Homepage-URLs); er aendert sich nur explizit. */
export async function updateKursangebot(db: Db, id: string, patch: Partial<KursangebotInput>): Promise<Kursangebot> {
  const n = normalisiere(patch);
  if ('slug' in n) n.slug = n.slug ? expliziterSlug(n.slug) : await freierSlug(db, slugify((await getKursangebot(db, id)).titel), id);
  const args: unknown[] = [id];
  const sets = patchSets(n as Record<string, unknown>, COLS, args);
  if (!sets.length) return getKursangebot(db, id);
  sets.push('geaendert_am=now()');
  const r = await db.query(`update kursangebot set ${sets.join(',')} where id=$1 returning *`, args).catch(alsKonflikt);
  if (!r.rowCount) throw new NotFoundError(`Kursangebot ${id} nicht gefunden`);
  return mapKursangebot(r.rows[0]);
}

export async function listKursangebote(db: Db, filter: { bereich?: string; aktiv?: boolean; oeffentlich?: boolean } = {}): Promise<Kursangebot[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (filter.bereich) add('bereich=?', filter.bereich);
  if (filter.aktiv !== undefined) add('aktiv=?', filter.aktiv);
  if (filter.oeffentlich !== undefined) add('oeffentlich=?', filter.oeffentlich);
  const r = await db.query(`select * from kursangebot ${cond.length ? 'where ' + cond.join(' and ') : ''} order by bereich, titel`, args);
  return r.rows.map(mapKursangebot);
}

// ---------------------------------------------------------------------------------------------
// Oeffentliches Lesemodell (Homepage / Public API v1): nur Angebots- und Termindaten, keine Personendaten.
// ---------------------------------------------------------------------------------------------

async function oeffentlicheKurse(db: Db, filter: { bereich?: string; slug?: string }, heute: string): Promise<OeffentlicherKurs[]> {
  const cond = ['oeffentlich', 'aktiv']; const args: unknown[] = [];
  if (filter.bereich) { args.push(filter.bereich); cond.push(`bereich=$${args.length}`); }
  if (filter.slug) { args.push(filter.slug); cond.push(`slug=$${args.length}`); }
  const ka = await db.query(`select * from kursangebot where ${cond.join(' and ')} order by bereich, titel`, args);
  if (!ka.rowCount) return [];

  const ids = ka.rows.map((r: any) => r.id);
  const dr = await db.query(
    `select d.id, d.kursangebot_id, d.code, d.start_datum, d.end_datum, d.ort, d.kapazitaet, d.anmeldeschluss,
            coalesce(d.preis_chf, k.preis_chf) as preis,
            (select count(*) from anmeldung a where a.durchfuehrung_id=d.id and a.status = any($3))::int as aktiv
     from durchfuehrung d join kursangebot k on k.id=d.kursangebot_id
     where d.kursangebot_id = any($1) and d.oeffentlich and d.status in ('ausgeschrieben','bestaetigt') and d.start_datum >= $2
     order by d.start_datum, d.code`,
    [ids, heute, AKTIVE_ANMELDESTATUS]);
  const kt = dr.rowCount
    ? await db.query('select durchfuehrung_id, datum, von, bis from kurstag where durchfuehrung_id = any($1) order by datum, von nulls first',
      [dr.rows.map((r: any) => r.id)])
    : { rows: [] as any[] };

  const kurstage = new Map<string, OeffentlicheDurchfuehrung['kurstage']>();
  for (const k of kt.rows) {
    const liste = kurstage.get(k.durchfuehrung_id) ?? [];
    liste.push({ datum: k.datum, von: zeitKurz(k.von), bis: zeitKurz(k.bis) });
    kurstage.set(k.durchfuehrung_id, liste);
  }
  const jeAngebot = new Map<string, OeffentlicheDurchfuehrung[]>();
  for (const d of dr.rows) {
    const liste = jeAngebot.get(d.kursangebot_id) ?? [];
    liste.push({
      id: d.id, code: d.code, startDatum: d.start_datum, endDatum: d.end_datum, ort: d.ort,
      kurstage: kurstage.get(d.id) ?? [], preisChf: num(d.preis), freiePlaetze: Math.max(0, d.kapazitaet - d.aktiv),
      wartelisteMoeglich: true, anmeldeschluss: d.anmeldeschluss,
    });
    jeAngebot.set(d.kursangebot_id, liste);
  }
  return ka.rows.map((r: any): OeffentlicherKurs => {
    const a = mapKursangebot(r);
    return {
      code: a.code, slug: a.slug, titel: a.titel, untertitel: a.untertitel, bereich: a.bereich, format: a.format,
      beschreibung: a.beschreibung, lernziele: a.lernziele, zielgruppe: a.zielgruppe, dauerTage: a.dauerTage,
      lernstunden: a.lernstunden, preisChf: a.preisChf, saqAnerkannt: a.saqAnerkannt,
      durchfuehrungen: jeAngebot.get(a.id) ?? [],
    };
  });
}

/**
 * Oeffentliche, aktive Kursangebote mit ihren ausgeschriebenen/bestaetigten, oeffentlichen Durchfuehrungen ab heute
 * (freie Plaetze, Warteliste moeglich). Angebote ohne kommende Termine erscheinen mit leerer Terminliste.
 */
export async function listOeffentlicheKurse(db: Db, opt: { bereich?: string; heute?: string } = {}): Promise<OeffentlicherKurs[]> {
  return oeffentlicheKurse(db, { bereich: opt.bereich }, opt.heute ?? heuteIso());
}

export async function getOeffentlichenKurs(db: Db, slug: string, opt: { heute?: string } = {}): Promise<OeffentlicherKurs> {
  const [k] = slug ? await oeffentlicheKurse(db, { slug }, opt.heute ?? heuteIso()) : [];
  if (!k) throw new NotFoundError(`Kurs ${slug} nicht gefunden`);
  return k;
}
