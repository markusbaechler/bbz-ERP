/*
 * Formular-Eingang der Homepage (Spec v2 §6.1): WPForms -> (Zapier | WPForms-Webhook) -> POST /public/v1/formulare/:formular.
 * Ersetzt den heutigen Weg Zapier -> SharePoint. Feldnamen werden tolerant gelesen (Gross/Klein, Umlaute,
 * deutsche Feldbeschriftungen der Website als Aliase), damit die Zaps nur die URL wechseln muessen.
 * Formulare und Felder: docs/analyse/WEBSITE-GESCHAEFTSPROZESSE.md §2.2.
 */

export type KontaktDaten = {
  anrede: 'Frau' | 'Herr' | null; vorname: string | null; nachname: string; email: string; telefon: string | null;
  mobile: string | null; funktion: string | null; geburtsdatum: string | null;
};

export type FormularBefehl =
  | { art: 'anfrage'; typ: 'kontakt' | 'offerte' | 'tailormade' | 'newsletter' | 'rueckruf'; kontakt: KontaktDaten; organisationName: string | null;
      interesse: string | null; nachricht: string | null; newsletter: boolean; einwilligung: boolean }
  | { art: 'anmeldung'; durchfuehrungCode: string; kontakt: KontaktDaten; organisationName: string | null; rechnungsreferenz: string | null; bemerkung: string | null }
  | { art: 'saq'; kontakt: KontaktDaten; organisationName: string | null; profil: string; umfang: string; variante: string; sprache: string;
      rolle: string | null; digitaleHilfsmittel: boolean; einwilligungRechnungBank: boolean; einwilligungWeitergabeGruppe: boolean; bemerkung: string | null };

export type FormularErgebnis = { ok: true; befehl: FormularBefehl; rohdaten: Record<string, unknown> } | { ok: false; fehler: string[] };

export const FORMULARE = ['kontakt', 'anfrage-uek-bem', 'clientis', 'dlp', 'bfk-uno', 'fuehrungseinstieg', 'anmeldung', 'saq-anmeldung'] as const;
export type Formular = typeof FORMULARE[number];

const norm = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '');

/** Kanonischer Schluessel -> akzeptierte Varianten (normalisiert verglichen). */
const ALIASE: Record<string, string[]> = {
  anrede: ['anrede', 'geschlecht', 'salutation', 'gender'],
  vorname: ['vorname', 'firstname'],
  nachname: ['nachname', 'lastname', 'familienname'],
  name: ['name', 'vorundnachname', 'vollername', 'fullname'],
  email: ['email', 'emailadresse', 'geschaeftlicheemail', 'geschaeftsemail', 'mail'],
  telefon: ['telefon', 'geschaeftstelefon', 'tel', 'phone', 'telefonnummer'],
  mobile: ['mobile', 'mobil', 'handy', 'natel'],
  funktion: ['funktion', 'funktionrolle', 'rolle', 'position'],
  geburtsdatum: ['geburtsdatum', 'birthdate', 'geburtstag'],
  bank: ['bank', 'bankinstitut', 'institut', 'firma', 'arbeitgeber', 'organisation', 'clientisbank', 'bankerfassen'],
  nachricht: ['nachricht', 'message', 'bemerkungen', 'bemerkung', 'anliegen', 'kommentar'],
  datenschutz: ['datenschutz', 'datenschutzerklaerung', 'privacy'],
  agb: ['agb', 'allgemeinegeschaeftsbedingungen'],
  newsletter: ['newsletter'],
  durchfuehrung: ['durchfuehrung', 'durchfuehrungscode', 'termin', 'kursdurchfuehrung'],
  rechnungsreferenz: ['rechnungsreferenz', 'kostenstelle', 'bestellnummer', 'instruktionenzurverrechnung', 'verrechnung'],
  angebot: ['angebot', 'kurs', 'thema'],
  anzahl: ['anzahlteilnehmende', 'anzahl', 'teilnehmende'],
  zeitraum: ['zeitraum', 'wunschtermin'],
  profil: ['profil', 'saqprofil', 'zertifikatsprofil'],
  umfang: ['anmeldungfuer', 'umfang', 'leistung'],
  variante: ['variante', 'teilpruefungen', 'teilpruefung', 'pruefungsvariante'],
  sprache: ['sprache', 'pruefungssprache', 'language'],
  hilfsmittel: ['digitalehilfsmittel', 'hilfsmittel'],
  einwilligungRechnung: ['einverstaendnisrechnung', 'rechnunganbank', 'einverstaendnisrechnunganbank'],
  einwilligungGruppe: ['einwilligungraiffeisen', 'datenweitergaberaiffeisen', 'weitergaberaiffeisen', 'einwilligungweitergabe'],
};

function feldLeser(roh: Record<string, unknown>) {
  const index = new Map<string, unknown>();
  for (const [k, v] of Object.entries(roh)) index.set(norm(k), v);
  return (kanonisch: string): string | null => {
    for (const a of ALIASE[kanonisch] ?? [kanonisch]) {
      const v = index.get(norm(a));
      if (v === undefined || v === null) continue;
      const s = Array.isArray(v) ? v.join(', ') : String(v).trim();
      if (s) return s;
    }
    return null;
  };
}

export const jaNein = (v: string | null): boolean => !!v && /^(1|true|ja|yes|on|x|checked|akzeptiert|einverstanden|ich (stimme|bin))/i.test(v.trim());

/** "Frau"/"Herr" bzw. Geschlecht M/W der SAQ-Anmeldung. */
export function anredeAus(v: string | null): 'Frau' | 'Herr' | null {
  if (!v) return null;
  const n = norm(v);
  if (['frau', 'w', 'weiblich', 'f', 'madame', 'signora'].includes(n)) return 'Frau';
  if (['herr', 'm', 'maennlich', 'monsieur', 'signore'].includes(n)) return 'Herr';
  return null;
}

/** dd.mm.yyyy | yyyy-mm-dd -> yyyy-mm-dd (sonst null) */
export function datumAus(v: string | null): string | null {
  if (!v) return null;
  const ch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  const [y, m, d] = ch ? [ch[3], ch[2].padStart(2, '0'), ch[1].padStart(2, '0')] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!y) return null;
  const dt = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d) ? null : `${y}-${m}-${d}`;
}

/** SAQ-Profil aus Formularwert (Codes und Langbezeichnungen der Website/KUBA). */
export function profilAus(v: string | null): string | null {
  if (!v) return null;
  const n = norm(v);
  const tabelle: [RegExp, string][] = [
    [/^(pk|privatkunden)/, 'PK'], [/^(ik|individualkunden)/, 'IK'], [/^(affl?|affluent)/, 'AFFL'],
    [/^cwma|wealth/, 'CWMA'], [/^kmu/, 'KMU'], [/^ccob|commercial/, 'CCoB'],
  ];
  return tabelle.find(([r]) => r.test(n))?.[1] ?? null;
}

export function umfangAus(v: string | null): string {
  const n = norm(v ?? '');
  if (n.includes('selbststudium') || n.includes('lehrgang')) return 'selbststudium';
  if (n.includes('gesamt')) return 'gesamtpaket';
  if (n.includes('muendlich')) return 'muendlich';
  if (n.includes('schriftlich')) return 'schriftlich';
  return 'gesamtpaket';
}

export function varianteAus(v: string | null): string {
  const n = norm(v ?? '');
  if (n.includes('passerelle')) return 'passerelle';
  if (/^tp\d|teilpruefung/.test(n)) return 'teilpruefung';
  if (n.includes('wiederhol')) return 'wiederholung';
  return 'erstzertifizierung';
}

/** Durchfuehrungs-Auswahl (z. B. "kompakt 2/2026") -> ERP-Durchfuehrungscode, falls die Homepage Codes liefert. */
const durchfuehrungAus = (v: string | null) => (v && /^[A-Z0-9]+(-[A-Z0-9]+)+$/i.test(v.trim()) ? v.trim().toUpperCase() : null);

const PFLICHT_EINWILLIGUNG: Formular[] = ['kontakt', 'dlp', 'bfk-uno', 'fuehrungseinstieg', 'saq-anmeldung', 'anmeldung'];

export function normalisiereFormular(formular: string, roh: Record<string, unknown>): FormularErgebnis {
  if (!(FORMULARE as readonly string[]).includes(formular)) return { ok: false, fehler: [`Unbekanntes Formular: ${formular}`] };
  const f = feldLeser(roh ?? {});
  const fehler: string[] = [];

  let vorname = f('vorname'); let nachname = f('nachname');
  if (!nachname && f('name')) {
    const teile = f('name')!.split(/\s+/);
    nachname = teile.length > 1 ? teile.slice(1).join(' ') : teile[0];
    vorname ??= teile.length > 1 ? teile[0] : null;
  }
  const email = f('email')?.toLowerCase() ?? null;
  if (!nachname) fehler.push('Name fehlt');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fehler.push('Gueltige E-Mail fehlt');
  if (PFLICHT_EINWILLIGUNG.includes(formular as Formular)) {
    if (!jaNein(f('datenschutz'))) fehler.push('Einwilligung Datenschutz fehlt');
    if (!jaNein(f('agb'))) fehler.push('AGB nicht akzeptiert');
  }
  const geburtsdatum = datumAus(f('geburtsdatum'));
  if (f('geburtsdatum') && !geburtsdatum) fehler.push(`Geburtsdatum unlesbar: ${f('geburtsdatum')}`);

  const kontakt: KontaktDaten = {
    anrede: anredeAus(f('anrede')), vorname, nachname: nachname ?? '', email: email ?? '', telefon: f('telefon'),
    mobile: f('mobile'), funktion: f('funktion'), geburtsdatum,
  };
  const organisationName = f('bank');
  const zusatz = (felder: [string, string][]) => felder.map(([k, label]) => (f(k) ? `${label}: ${f(k)}` : null)).filter(Boolean).join('\n') || null;

  let befehl: FormularBefehl;
  switch (formular as Formular) {
    case 'kontakt':
      befehl = { art: 'anfrage', typ: 'kontakt', kontakt, organisationName, interesse: null, nachricht: f('nachricht'), newsletter: jaNein(f('newsletter')), einwilligung: jaNein(f('datenschutz')) };
      break;
    case 'anfrage-uek-bem':
      if (!organisationName) fehler.push('Bank fehlt');
      befehl = { art: 'anfrage', typ: 'offerte', kontakt, organisationName, interesse: 'nachwuchs', nachricht: f('nachricht'), newsletter: false, einwilligung: true };
      break;
    case 'clientis':
      befehl = { art: 'anfrage', typ: 'tailormade', kontakt, organisationName, interesse: f('angebot'),
        nachricht: zusatz([['angebot', 'Angebot'], ['anzahl', 'Anzahl Teilnehmende'], ['zeitraum', 'Zeitraum'], ['nachricht', 'Nachricht']]), newsletter: false, einwilligung: true };
      break;
    case 'saq-anmeldung': {
      const profil = profilAus(f('profil'));
      if (!profil) fehler.push(`Profil fehlt oder unbekannt: ${f('profil') ?? '–'}`);
      if (!organisationName) fehler.push('Bank fehlt');
      if (!jaNein(f('einwilligungRechnung'))) fehler.push('Einverstaendnis zur Rechnung an die Bank fehlt');
      const sprache = (f('sprache') ?? 'DE').slice(0, 2).toUpperCase();
      befehl = { art: 'saq', kontakt, organisationName, profil: profil ?? '', umfang: umfangAus(f('umfang')), variante: varianteAus(f('variante')),
        sprache: ['DE', 'FR', 'IT', 'EN'].includes(sprache) ? sprache : 'DE', rolle: f('funktion'),
        digitaleHilfsmittel: jaNein(f('hilfsmittel')), einwilligungRechnungBank: jaNein(f('einwilligungRechnung')),
        einwilligungWeitergabeGruppe: jaNein(f('einwilligungGruppe')), bemerkung: f('nachricht') };
      break;
    }
    default: { // dlp, bfk-uno, fuehrungseinstieg, anmeldung
      const code = durchfuehrungAus(f('durchfuehrung'));
      befehl = code
        ? { art: 'anmeldung', durchfuehrungCode: code, kontakt, organisationName, rechnungsreferenz: f('rechnungsreferenz'), bemerkung: f('nachricht') }
        : { art: 'anfrage', typ: 'offerte', kontakt, organisationName, interesse: formular === 'bfk-uno' ? 'nachwuchs' : 'weiterbildung',
            nachricht: zusatz([['durchfuehrung', 'Gewünschte Durchführung'], ['rechnungsreferenz', 'Verrechnung'], ['nachricht', 'Bemerkungen']]) ?? `Anmeldung ${formular}`,
            newsletter: false, einwilligung: true };
    }
  }
  return fehler.length ? { ok: false, fehler } : { ok: true, befehl, rohdaten: roh };
}
