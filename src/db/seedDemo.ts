/**
 * Demo-Daten fuer die PWA (`npm run seed:demo`). Laeuft ausschliesslich ueber die Repos (keine HTTP-Aufrufe),
 * Termine relativ zu heute (Europe/Zurich). NUR synthetische Namen ("Muster", "Beispiel") und fiktive Banken.
 * Idempotent-ish: sind die Demo-Mitarbeitenden (ml/ph/sk) schon vorhanden, bricht das Skript ohne Aenderung ab.
 */
import type pg from 'pg';
import { getPool, closePool } from './pool';
import { runMigrations } from './migrate';
import { heuteIso } from '../domain/crm';
import { createMitarbeitende } from '../repos/mitarbeitendeRepo';
import { createKonto, listKonten } from '../repos/kontoRepo';
import { createMwstSatz } from '../repos/mwstSatzRepo';
import { createAuftraggeber } from '../repos/auftraggeberRepo';
import { createOrganisation, verknuepfeAuftraggeber } from '../repos/organisationRepo';
import { createKontakt } from '../repos/kontaktRepo';
import { createAktivitaet } from '../repos/aktivitaetRepo';
import { createVerkaufschance, setzePhase, eroeffneProjekt } from '../repos/verkaufschanceRepo';
import { createAnfrage } from '../repos/anfrageRepo';
import { createProjekt, updateProjekt, setProjektStatus } from '../repos/projektRepo';
import { createPhase } from '../repos/phaseRepo';
import { createMeilenstein, setMeilensteinErreicht } from '../repos/meilensteinRepo';
import { createAufgabe } from '../repos/aufgabeRepo';
import { createZeiterfassung, zeitVerrechnen } from '../repos/zeiterfassungRepo';
import { createReferent } from '../repos/referentRepo';
import { createEinsatz } from '../repos/einsatzRepo';
import { createKursangebot } from '../repos/kursangebotRepo';
import { createDurchfuehrung, setDurchfuehrungStatus, referentZuweisen } from '../repos/durchfuehrungRepo';
import { meldeAn, bestaetigeAnmeldung, setzeTeilnahme, storniereAnmeldung } from '../repos/anmeldungRepo';
import { createZertifizierung, createLernnachweis } from '../repos/lernnachweisRepo';
import { createSaqFall, planePruefung, erfasseResultat, setzeArbeitgeberbestaetigung, stelleZertifikatAus } from '../repos/saqRepo';
import { festschreiben } from '../repos/rechnungRepo';
import { erfasseZahlung } from '../repos/debitorRepo';
import { createApiClient } from '../repos/apiClientRepo';

const HEUTE = heuteIso();
const tag = (n: number): string => {
  const d = new Date(`${HEUTE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Werktag ab einem Datum (Sa/So -> Montag). */
const abWerktag = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
/** Naechster Werktag ab heute + n. */
const werktag = (n: number): string => abWerktag(tag(n));
/** Folgender Werktag nach `iso`. */
const folgeWerktag = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return abWerktag(d.toISOString().slice(0, 10));
};
const zeitpunkt = (n: number, stunde = 10): string => `${tag(n)}T${String(stunde).padStart(2, '0')}:00:00+01:00`;
const JAHR = Number(HEUTE.slice(0, 4));

export async function seedDemo(pool: pg.Pool, log: (s: string) => void = console.log): Promise<boolean> {
  const vorhanden = await pool.query(`select 1 from mitarbeitende where kuerzel in ('ml','ph','sk') limit 1`);
  if (vorhanden.rowCount) {
    log('Demo-Daten sind bereits vorhanden (Mitarbeitende ml/ph/sk) – nichts geaendert.');
    return false;
  }

  // --- Personal ---------------------------------------------------------------------------------
  const ml = await createMitarbeitende(pool, { kuerzel: 'ml', vorname: 'Lena', nachname: 'Muster', email: 'lena.muster@bbz.example', rolle: 'admin', stundensatzIntern: 95, stundensatzVerrechnung: 220 });
  const ph = await createMitarbeitende(pool, { kuerzel: 'ph', vorname: 'Paul', nachname: 'Beispiel', email: 'paul.beispiel@bbz.example', rolle: 'standard', stundensatzIntern: 85, stundensatzVerrechnung: 200 });
  const sk = await createMitarbeitende(pool, { kuerzel: 'sk', vorname: 'Sara', nachname: 'Exempel', email: 'sara.exempel@bbz.example', rolle: 'standard', stundensatzIntern: 80, stundensatzVerrechnung: 180 });

  // --- Kontenplan + MWSt ------------------------------------------------------------------------
  const konten = new Map((await listKonten(pool)).map((k) => [k.nummer, k]));
  const konto = async (nummer: string, bezeichnung: string, typ: 'Ertrag' | 'Aufwand') =>
    konten.get(nummer) ?? createKonto(pool, { nummer, bezeichnung, typ });
  const kBeratung = await konto('3200', 'Ertrag Beratung', 'Ertrag');
  const kKurse = await konto('3400', 'Ertrag offene Kurse', 'Ertrag');
  const kFirmenkurse = await konto('3410', 'Ertrag Firmenkurse', 'Ertrag');
  await konto('4000', 'Aufwand Honorare Referierende', 'Aufwand');
  const mwstVorhanden = (await pool.query('select count(*)::int as n from mwst_satz')).rows[0].n > 0;
  if (!mwstVorhanden) {
    await createMwstSatz(pool, { satz: 8.1, bezeichnung: 'Normalsatz', gueltigAb: '2024-01-01' });
    await createMwstSatz(pool, { satz: 2.6, bezeichnung: 'Reduzierter Satz', gueltigAb: '2024-01-01' });
    await createMwstSatz(pool, { satz: 3.8, bezeichnung: 'Sondersatz Beherbergung', gueltigAb: '2024-01-01' });
    await createMwstSatz(pool, { satz: 0, bezeichnung: 'Von der Steuer ausgenommen (Bildung)', gueltigAb: '2024-01-01' });
  }

  // --- Banken (Organisation + verknuepfter Debitor) ------------------------------------------------
  const bank = async (name: string, d: { kategorie: 'kunde' | 'interessent'; klass: 'A' | 'B' | 'C' | 'akquisition' | null; strasse: string; plz: string; ort: string; nummer: string; betreuer: string; vip?: boolean; web: string }) => {
    const org = await createOrganisation(pool, {
      name, kategorie: d.kategorie, klassifizierung: d.klass, vip: d.vip ?? false, branche: 'Bank', strasse: d.strasse, plz: d.plz,
      ort: d.ort, telefon: '+41 71 000 00 00', email: `info@${d.web}`, website: `https://www.${d.web}`, betreuerId: d.betreuer,
    });
    const ag = await verknuepfeAuftraggeber(pool, org.id, { nummer: d.nummer });
    return { org, ag };
  };
  const musterbank = await bank('Musterbank AG', { kategorie: 'kunde', klass: 'A', vip: true, strasse: 'Bahnhofstrasse 10', plz: '9000', ort: 'St. Gallen', nummer: '20001', betreuer: ml.id, web: 'musterbank.example' });
  const kantonalbank = await bank('Beispiel Kantonalbank', { kategorie: 'kunde', klass: 'A', strasse: 'Beispielplatz 1', plz: '8001', ort: 'Zürich', nummer: '20002', betreuer: ph.id, web: 'beispiel-kb.example' });
  const mustertal = await bank('Genossenschaftsbank Mustertal', { kategorie: 'kunde', klass: 'B', strasse: 'Dorfstrasse 5', plz: '9100', ort: 'Herisau', nummer: '20003', betreuer: ph.id, web: 'gb-mustertal.example' });
  const beispielsee = await bank('Regionalbank Beispielsee AG', { kategorie: 'kunde', klass: 'C', strasse: 'Seeweg 12', plz: '8590', ort: 'Romanshorn', nummer: '20004', betreuer: sk.id, web: 'rb-beispielsee.example' });
  const privatbank = await bank('Privatbank Muster & Cie', { kategorie: 'interessent', klass: 'akquisition', strasse: 'Bankgasse 3', plz: '6900', ort: 'Lugano', nummer: '20005', betreuer: ml.id, web: 'pb-muster.example' });
  const sparkasse = await bank('Sparkasse Beispielstadt', { kategorie: 'kunde', klass: null, strasse: 'Marktgasse 7', plz: '3011', ort: 'Bern', nummer: '20006', betreuer: sk.id, web: 'sk-beispielstadt.example' });
  // Interessent ohne Debitor (fuer "als Debitor anlegen" in der Oberflaeche)
  const vv = await createOrganisation(pool, { name: 'Beispiel Vermögensverwaltung AG', kategorie: 'interessent', branche: 'Vermögensverwaltung', strasse: 'Quaistrasse 2', plz: '6003', ort: 'Luzern', betreuerId: ml.id, email: 'kontakt@bvv.example' });
  const kostenstelle = await createAuftraggeber(pool, { nummer: '90001', name: 'Kostenstelle Offene Kurse (intern)', strasse: 'Musterstrasse 1', plz: '9000', ort: 'St. Gallen' });

  // --- Kontakte -----------------------------------------------------------------------------------
  const kontakt = (vorname: string, nachname: string, orgId: string | null, domain: string, extra: Record<string, unknown> = {}) =>
    createKontakt(pool, {
      vorname, nachname, organisationId: orgId, anrede: (extra.anrede as any) ?? null,
      email: `${vorname}.${nachname}`.toLowerCase().replace(/[^a-z.]/g, '') + `@${domain}`, ...extra,
    } as any);
  const anna = await kontakt('Anna', 'Muster', musterbank.org.id, 'musterbank.example', { anrede: 'Frau', funktion: 'Leiterin Vertrieb', betreuerId: ml.id, interessen: ['weiterbildung', 'beratung'], prioritaet: 'hoch', newsletter: true, einwilligungQuelle: 'Demo' });
  const beat = await kontakt('Beat', 'Beispiel', musterbank.org.id, 'musterbank.example', { anrede: 'Herr', funktion: 'Leiter HR', betreuerId: ml.id, interessen: ['nachwuchs'] });
  const claudia = await kontakt('Claudia', 'Musterli', musterbank.org.id, 'musterbank.example', { anrede: 'Frau', funktion: 'Kundenberaterin', interessen: ['zertifizierung'], newsletter: true, einwilligungQuelle: 'Demo' });
  const nina = await kontakt('Nina', 'Probe-Muster', musterbank.org.id, 'musterbank.example', { anrede: 'Frau', funktion: 'Kundenberaterin' });
  const daniel = await kontakt('Daniel', 'Exempel', kantonalbank.org.id, 'beispiel-kb.example', { anrede: 'Herr', funktion: 'Bereichsleiter Privatkunden', betreuerId: ph.id, interessen: ['tailormade'] });
  const eva = await kontakt('Eva', 'Probe', kantonalbank.org.id, 'beispiel-kb.example', { anrede: 'Frau', funktion: 'Ausbildungsverantwortliche', interessen: ['nachwuchs', 'weiterbildung'], newsletter: true, einwilligungQuelle: 'Demo' });
  const fabian = await kontakt('Fabian', 'Mustermann', mustertal.org.id, 'gb-mustertal.example', { anrede: 'Herr', funktion: 'Kundenberater' });
  const gabriela = await kontakt('Gabriela', 'Vorlage', mustertal.org.id, 'gb-mustertal.example', { anrede: 'Frau', funktion: 'Geschäftsleiterin', betreuerId: ph.id, interessen: ['beratung'] });
  const hans = await kontakt('Hans', 'Beispielmann', beispielsee.org.id, 'rb-beispielsee.example', { anrede: 'Herr', funktion: 'Kundenberater' });
  const irene = await kontakt('Irene', 'Testa', beispielsee.org.id, 'rb-beispielsee.example', { anrede: 'Frau', funktion: 'Leiterin Personal', betreuerId: sk.id, interessen: ['weiterbildung'] });
  const oliver = await kontakt('Oliver', 'Beispiel', beispielsee.org.id, 'rb-beispielsee.example', { anrede: 'Herr', funktion: 'Kundenberater' });
  const jonas = await kontakt('Jonas', 'Modell', privatbank.org.id, 'pb-muster.example', { anrede: 'Herr', funktion: 'CEO', betreuerId: ml.id, interessen: ['beratung'], prioritaet: 'hoch' });
  await kontakt('Karin', 'Schablone', privatbank.org.id, 'pb-muster.example', { anrede: 'Frau', funktion: 'Leiterin Compliance' });
  const lukas = await kontakt('Lukas', 'Entwurf', sparkasse.org.id, 'sk-beispielstadt.example', { anrede: 'Herr', funktion: 'Leiter Ausbildung', betreuerId: sk.id, interessen: ['nachwuchs'] });
  await kontakt('Monika', 'Skizze', vv.id, 'bvv.example', { anrede: 'Frau', funktion: 'Partnerin' });
  const petra = await kontakt('Petra', 'Lehrmuster', null, 'lehrmuster.example', { anrede: 'Frau', titel: 'Dr.', funktion: 'Dozentin Anlageberatung' });

  // --- Aktivitaeten -------------------------------------------------------------------------------
  const akt: [string, string, string | null, string | null, number, string, string | null][] = [
    ['besuch', 'Jahresgespräch Vertrieb', anna.id, null, -3, ml.id, 'Zielvereinbarung 2027 besprochen, Interesse an Führungsmodul.'],
    ['telefon', 'Rückfrage Teilnehmerliste Firmenkurs', daniel.id, null, -6, ph.id, null],
    ['email', 'Offerte Führungsentwicklung versendet', irene.id, null, -12, sk.id, 'Offerte inkl. Varianten A/B.'],
    ['meeting', 'Kick-off Strategieberatung', jonas.id, null, -18, ml.id, 'Erstgespräch, Auftrag in Offertphase.'],
    ['telefon', 'Nachwuchsprogramm abgeklärt', lukas.id, null, -25, sk.id, null],
    ['event', 'Bankentag Ostschweiz', gabriela.id, null, -33, ph.id, null],
    ['notiz', 'Budgetrunde abwarten', null, beispielsee.org.id, -40, sk.id, 'Entscheid nach Budgetrunde im Dezember.'],
    ['offerte', 'SAQ-Vorbereitung offeriert', fabian.id, null, -48, ph.id, null],
    ['brief', 'Neujahrskarte', beat.id, null, -300, ml.id, null],
    ['meeting', 'Workshop Analyse', anna.id, null, -52, ml.id, 'Interviews mit 8 Kundenberatenden geplant.'],
  ];
  for (const [typ, betreff, kontaktId, organisationId, t, maId, notizen] of akt) {
    await createAktivitaet(pool, { typ: typ as any, betreff, kontaktId, organisationId, datum: zeitpunkt(t), mitarbeitendeId: maId, notizen });
  }

  // --- Verkaufschancen (alle Phasen) --------------------------------------------------------------
  const vc = (titel: string, organisationId: string, d: { kontaktId?: string; wertChf: number; abschluss: number; verantwortlichId: string; bereich: string }) =>
    createVerkaufschance(pool, { titel, organisationId, kontaktId: d.kontaktId ?? null, wertChf: d.wertChf, erwarteterAbschluss: tag(d.abschluss), verantwortlichId: d.verantwortlichId, bereich: d.bereich, quelle: 'Demo' });
  await vc('Nachwuchsprogramm 2027', sparkasse.org.id, { kontaktId: lukas.id, wertChf: 18000, abschluss: 120, verantwortlichId: sk.id, bereich: 'Nachwuchs' });
  const vcQual = await vc('Führungsentwicklung Kader', beispielsee.org.id, { kontaktId: irene.id, wertChf: 32000, abschluss: 75, verantwortlichId: sk.id, bereich: 'Führung' });
  await setzePhase(pool, vcQual.id, { phase: 'qualifiziert', heute: HEUTE, benutzer: 'sk' });
  const vcOff = await vc('Strategieberatung Privatbank', privatbank.org.id, { kontaktId: jonas.id, wertChf: 25000, abschluss: 30, verantwortlichId: ml.id, bereich: 'Beratung' });
  await setzePhase(pool, vcOff.id, { phase: 'offeriert', heute: HEUTE, benutzer: 'ml' });
  const vcVerh = await vc('SAQ-Vorbereitung Kundenberatende', mustertal.org.id, { kontaktId: gabriela.id, wertChf: 15000, abschluss: 20, verantwortlichId: ph.id, bereich: 'Zertifizierung' });
  await setzePhase(pool, vcVerh.id, { phase: 'verhandlung', heute: HEUTE, benutzer: 'ph' });
  const vcGew = await vc('Firmenkurs Compliance 2027', kantonalbank.org.id, { kontaktId: daniel.id, wertChf: 9000, abschluss: -5, verantwortlichId: ph.id, bereich: 'Firmenkurse' });
  await setzePhase(pool, vcGew.id, { phase: 'gewonnen', heute: HEUTE, benutzer: 'ph' });
  const vcVerl = await vc('Coaching Teamleitende', beispielsee.org.id, { kontaktId: irene.id, wertChf: 8000, abschluss: -20, verantwortlichId: sk.id, bereich: 'Führung' });
  await setzePhase(pool, vcVerl.id, { phase: 'verloren', verlustgrund: 'Budget gestrichen', heute: HEUTE, benutzer: 'sk' });
  // Gewonnen MIT Projekt (Projekt eroeffnen aus der Chance)
  const vcProj = await vc('Vertriebsentwicklung Musterbank', musterbank.org.id, { kontaktId: anna.id, wertChf: 40000, abschluss: -62, verantwortlichId: ml.id, bereich: 'Beratung' });
  const { projekt: p1Basis } = await eroeffneProjekt(pool, vcProj.id, { stammnummer: 6301, jahr: JAHR, ertragskontoId: kBeratung.id, heute: HEUTE, benutzer: 'ml' });

  // --- Anfragen-Eingang ---------------------------------------------------------------------------
  await createAnfrage(pool, { quelle: 'homepage', typ: 'offerte', anrede: 'Frau', vorname: 'Paula', nachname: 'Neumuster', email: 'paula.neumuster@bvv.example', organisationName: 'Beispiel Vermögensverwaltung AG', funktion: 'Partnerin', interesse: 'tailormade', nachricht: 'Wir interessieren uns für einen Firmenkurs zum Thema Anlageberatung für 12 Personen im Frühling.' });
  await createAnfrage(pool, { quelle: 'telefon', typ: 'rueckruf', vorname: 'Rolf', nachname: 'Anrufer', telefon: '+41 79 000 00 01', organisationName: 'Regionalbank Beispielsee AG', nachricht: 'Bitte um Rückruf wegen SAQ-Rezertifizierung.' });
  await createAnfrage(pool, { quelle: 'email', typ: 'kontakt', anrede: 'Herr', vorname: 'Simon', nachname: 'Anfrage', email: 'simon.anfrage@musterbank.example', organisationName: 'Musterbank AG', interesse: 'weiterbildung', nachricht: 'Gibt es 2027 wieder einen Kurs «Grundlagen Anlageberatung»?', newsletter: true, einwilligung: true });

  // --- Projekte -----------------------------------------------------------------------------------
  const p1 = await updateProjekt(pool, p1Basis.id, {
    budgetChf: 40000, budgetStunden: 180, projektleitungId: ml.id, startDatum: tag(-60), endDatum: tag(90),
    beschrieb: 'Vertriebsentwicklung im Privatkundengeschäft: Analyse, Konzept, Umsetzung mit Schulungen.', ansprechpersonKontaktId: anna.id,
  });
  const p2 = await createProjekt(pool, { stammnummer: 6302, jahr: JAHR, name: 'Firmenkurs Beispiel Kantonalbank', auftraggeberId: kantonalbank.ag.id, ertragskontoId: kFirmenkurse.id, bereich: 'Firmenkurse', budgetChf: 12000, budgetStunden: 60, projektleitungId: ph.id, startDatum: tag(-30), endDatum: tag(30), status: 'laufend', ansprechpersonKontaktId: daniel.id });
  const p3 = await createProjekt(pool, { stammnummer: 6303, jahr: JAHR, name: 'Offene Kurse', auftraggeberId: kostenstelle.id, ertragskontoId: kKurse.id, bereich: 'Kurse', projektleitungId: sk.id, startDatum: `${JAHR}-01-01`, endDatum: `${JAHR}-12-31`, status: 'laufend' });
  const p4 = await createProjekt(pool, { stammnummer: 6304, jahr: JAHR, name: 'Strategieberatung Privatbank Muster & Cie', auftraggeberId: privatbank.ag.id, ertragskontoId: kBeratung.id, bereich: 'Beratung', budgetChf: 25000, budgetStunden: 110, projektleitungId: ml.id, startDatum: tag(20), endDatum: tag(150), status: 'akquise', ansprechpersonKontaktId: jonas.id });
  await setProjektStatus(pool, p4.id, 'offeriert', { benutzer: 'ml' });

  // Phasen, Meilensteine, Aufgaben P1 (Abhaengigkeitskette A -> B -> C)
  const ph1 = await createPhase(pool, p1.id, { name: 'Analyse', startDatum: tag(-60), endDatum: tag(-25), status: 'abgeschlossen' });
  const ph2 = await createPhase(pool, p1.id, { name: 'Konzept', startDatum: tag(-24), endDatum: tag(20), status: 'aktiv' });
  const ph3 = await createPhase(pool, p1.id, { name: 'Umsetzung', startDatum: tag(21), endDatum: tag(90) });
  const ms1 = await createMeilenstein(pool, p1.id, { titel: 'Analysebericht abgegeben', faelligAm: tag(-26), phaseId: ph1.id });
  await setMeilensteinErreicht(pool, ms1.id, tag(-27));
  await createMeilenstein(pool, p1.id, { titel: 'Konzept-Workshop', faelligAm: tag(12), phaseId: ph2.id });
  await createMeilenstein(pool, p1.id, { titel: 'Abschlusspräsentation', faelligAm: tag(88), phaseId: ph3.id });
  const a1 = await createAufgabe(pool, { projektId: p1.id, phaseId: ph1.id, titel: 'Interviews Kundenberatung durchführen', status: 'erledigt', startDatum: tag(-55), faelligAm: tag(-35), zustaendigId: ph.id, schaetzungStunden: 16 }, { erstelltDurch: 'ml' });
  const a2 = await createAufgabe(pool, { projektId: p1.id, phaseId: ph2.id, titel: 'Konzeptentwurf erstellen', status: 'in_arbeit', startDatum: tag(-20), faelligAm: tag(5), zustaendigId: ml.id, vorgaengerId: a1.id, prioritaet: 'hoch', schaetzungStunden: 24 }, { erstelltDurch: 'ml' });
  await createAufgabe(pool, { projektId: p1.id, phaseId: ph2.id, titel: 'Konzept-Workshop durchführen', status: 'offen', startDatum: tag(8), faelligAm: tag(12), zustaendigId: ml.id, vorgaengerId: a2.id }, { erstelltDurch: 'ml' });
  await createAufgabe(pool, { projektId: p1.id, phaseId: ph2.id, titel: 'Auswertung Interviews prüfen', status: 'review', startDatum: tag(-10), faelligAm: tag(-2), zustaendigId: sk.id }, { erstelltDurch: 'ml' });
  await createAufgabe(pool, { projektId: p1.id, phaseId: ph3.id, titel: 'Kick-off Umsetzung planen', status: 'offen', faelligAm: tag(18), zustaendigId: ph.id }, { erstelltDurch: 'ml' });
  await createAufgabe(pool, { projektId: p1.id, phaseId: ph3.id, titel: 'Schulungsunterlagen entwerfen', status: 'offen', startDatum: tag(21), faelligAm: tag(45), zustaendigId: sk.id, prioritaet: 'tief', schaetzungStunden: 30 }, { erstelltDurch: 'ml' });

  // P2: ueberfaelliger Meilenstein (> 14 Tage) -> Ampel rot
  const p2a = await createPhase(pool, p2.id, { name: 'Vorbereitung', startDatum: tag(-30), endDatum: tag(-1), status: 'aktiv' });
  await createPhase(pool, p2.id, { name: 'Durchführung', startDatum: tag(0), endDatum: tag(30) });
  await createMeilenstein(pool, p2.id, { titel: 'Teilnehmerliste erhalten', faelligAm: tag(-20), phaseId: p2a.id });
  await createMeilenstein(pool, p2.id, { titel: 'Kursabschluss', faelligAm: tag(28) });
  await createAufgabe(pool, { projektId: p2.id, phaseId: p2a.id, titel: 'Kursunterlagen anpassen', status: 'in_arbeit', startDatum: tag(-14), faelligAm: tag(3), zustaendigId: ph.id }, { erstelltDurch: 'ph' });
  await createAufgabe(pool, { projektId: p2.id, titel: 'Raum und Verpflegung bestätigen', status: 'offen', faelligAm: tag(4), zustaendigId: sk.id }, { erstelltDurch: 'ph' });

  // P4: Meilenstein 5 Tage ueberfaellig -> Ampel gelb
  await createPhase(pool, p4.id, { name: 'Offertphase', startDatum: tag(-15), endDatum: tag(19), status: 'aktiv' });
  await createMeilenstein(pool, p4.id, { titel: 'Offerte nachgefasst', faelligAm: tag(-5) });
  await createAufgabe(pool, { projektId: p4.id, titel: 'Offerte finalisieren', status: 'offen', faelligAm: tag(2), zustaendigId: ml.id, prioritaet: 'hoch' }, { erstelltDurch: 'ml' });

  // CRM-Wiedervorlagen (Aufgaben ohne Projekt)
  await createAufgabe(pool, { titel: 'Offerte Führungsentwicklung nachfassen', organisationId: beispielsee.org.id, verkaufschanceId: vcQual.id, faelligAm: tag(-3), zustaendigId: ml.id, prioritaet: 'hoch' }, { erstelltDurch: 'ml' });
  await createAufgabe(pool, { titel: 'Jahresgespräch 2027 vereinbaren', kontaktId: anna.id, faelligAm: tag(1), zustaendigId: ml.id }, { erstelltDurch: 'ml' });
  await createAufgabe(pool, { titel: 'Newsletter-Einwilligung klären', kontaktId: lukas.id, zustaendigId: ml.id }, { erstelltDurch: 'ml' });
  await createAufgabe(pool, { titel: 'Teilnehmerliste Firmenkurs anfordern', organisationId: kantonalbank.org.id, faelligAm: tag(2), zustaendigId: ph.id }, { erstelltDurch: 'ph' });

  // Zeiterfassung
  const zeit = (projektId: string, maId: string, t: number, stunden: number, taetigkeit: string, verrechenbar = true) =>
    createZeiterfassung(pool, { projektId, mitarbeitendeId: maId, datum: tag(t), stunden, taetigkeit, verrechenbar });
  for (const [t, h, txt] of [[-50, 4, 'Interviews'], [-46, 6, 'Interviews'], [-44, 3.5, 'Auswertung'], [-30, 5, 'Analysebericht'], [-12, 4, 'Konzept'], [-5, 6, 'Konzept'], [-1, 3, 'Konzept']] as const) await zeit(p1.id, ml.id, t, h, txt);
  for (const [t, h, txt] of [[-49, 7, 'Interviews'], [-45, 7, 'Interviews'], [-42, 2, 'Projektadministration']] as const) await zeit(p1.id, ph.id, t, h, txt, txt !== 'Projektadministration');
  for (const [t, h, txt] of [[-8, 3, 'Auswertung'], [-2, 2.5, 'Auswertung']] as const) await zeit(p1.id, sk.id, t, h, txt);
  for (const [t, h, txt] of [[-28, 6, 'Kursvorbereitung'], [-26, 8, 'Kursvorbereitung'], [-22, 7.5, 'Unterlagen'], [-18, 6, 'Unterlagen'], [-12, 8, 'Kursvorbereitung'], [-7, 6.5, 'Unterlagen'], [-3, 4, 'Abstimmung Kunde']] as const) await zeit(p2.id, ph.id, t, h, txt);
  await zeit(p3.id, sk.id, -4, 3, 'Kursadministration', false);
  await zeit(p4.id, ml.id, -16, 3, 'Offerte erstellen', false);

  // --- Referent:innen + Einsaetze -----------------------------------------------------------------
  const refIntern = await createReferent(pool, { typ: 'intern', mitarbeitendeId: ph.id, fachgebiete: ['Vertrieb', 'Führung'], tagessatzChf: 1800, halbtagessatzChf: 1000 });
  const refExtern = await createReferent(pool, { typ: 'extern', kontaktId: petra.id, anzeigename: 'Dr. Petra Lehrmuster', fachgebiete: ['Anlageberatung', 'SAQ'], tagessatzChf: 2200, halbtagessatzChf: 1200 });
  await createEinsatz(pool, { referentId: refIntern.id, projektId: p1.id, datum: werktag(12), rolle: 'Moderation', status: 'bestaetigt' });
  await createEinsatz(pool, { referentId: refExtern.id, projektId: p1.id, datum: werktag(40), rolle: 'Fachinput', dauerTage: 0.5 });
  const firmenkursTag1 = werktag(5);
  await createEinsatz(pool, { referentId: refExtern.id, projektId: p2.id, datum: firmenkursTag1, rolle: 'Referentin', status: 'bestaetigt' });
  await createEinsatz(pool, { referentId: refExtern.id, projektId: p2.id, datum: folgeWerktag(firmenkursTag1), rolle: 'Referentin', status: 'bestaetigt' });

  // --- Bildung: Kursangebote, Durchfuehrungen, Kurstage, Anmeldungen --------------------------------
  const bef = await createKursangebot(pool, { code: 'BEF', titel: 'Grundlagen Anlageberatung', untertitel: 'Blended Learning mit Lernreise', bereich: 'Banking', format: 'blended', dauerTage: 2, lernstunden: 12, preisChf: 1450, mwstSatz: 0, ertragskontoId: kKurse.id, saqAnerkannt: true, oeffentlich: true, zielgruppe: 'Kundenberatende Privatkunden' });
  const saqv = await createKursangebot(pool, { code: 'SAQV', titel: 'SAQ-Vorbereitung Kundenberater Bank', bereich: 'Zertifizierung', format: 'praesenz', dauerTage: 1, lernstunden: 8, preisChf: 690, mwstSatz: 0, ertragskontoId: kKurse.id, saqAnerkannt: true, oeffentlich: true });
  const fue = await createKursangebot(pool, { code: 'FUE', titel: 'Führungseinstieg', bereich: 'Führung', format: 'praesenz', dauerTage: 3, lernstunden: 18, preisChf: 2400, mwstSatz: 0, ertragskontoId: kKurse.id, oeffentlich: true });

  // Vergangene Durchfuehrung (durchgefuehrt, Abschluss -> Lernnachweis)
  const altStart = werktag(-40);
  const dAlt = await createDurchfuehrung(pool, { kursangebotId: bef.id, startDatum: altStart, endDatum: folgeWerktag(altStart), ort: 'St. Gallen', kapazitaet: 12, projektId: p3.id });
  await setDurchfuehrungStatus(pool, dAlt.id, 'ausgeschrieben', 'sk');
  const altC = await meldeAn(pool, dAlt.id, { kontaktId: claudia.id });
  const altO = await meldeAn(pool, dAlt.id, { kontaktId: oliver.id });
  const altB = await meldeAn(pool, dAlt.id, { kontaktId: beat.id });
  await storniereAnmeldung(pool, altB.anmeldung.id, { grund: 'Terminkollision', datum: tag(-80) }, 'sk');
  await setDurchfuehrungStatus(pool, dAlt.id, 'bestaetigt', 'sk');
  await referentZuweisen(pool, dAlt.kurstage[0].id, { referentId: refExtern.id, rolle: 'Referentin' });
  await setDurchfuehrungStatus(pool, dAlt.id, 'durchgefuehrt', 'sk');
  await setzeTeilnahme(pool, altC.anmeldung.id, 'abgeschlossen', 'sk');
  await setzeTeilnahme(pool, altO.anmeldung.id, 'teilgenommen', 'sk');

  // Naechste Durchfuehrung BEF: Kapazitaet 4 -> voll + Warteliste
  const befStart = werktag(14);
  const dBef = await createDurchfuehrung(pool, { kursangebotId: bef.id, startDatum: befStart, endDatum: folgeWerktag(befStart), ort: 'St. Gallen', kapazitaet: 4, anmeldeschluss: tag(7), projektId: p3.id, leitungId: sk.id });
  await setDurchfuehrungStatus(pool, dBef.id, 'ausgeschrieben', 'sk');
  const b1 = await meldeAn(pool, dBef.id, { kontaktId: anna.id });
  const b2 = await meldeAn(pool, dBef.id, { kontaktId: daniel.id, rechnungsreferenz: 'KST 4711' });
  await meldeAn(pool, dBef.id, { kontaktId: fabian.id });
  await meldeAn(pool, dBef.id, { kontaktId: hans.id });
  await meldeAn(pool, dBef.id, { kontaktId: nina.id });           // -> Warteliste
  await bestaetigeAnmeldung(pool, b1.anmeldung.id, 'sk');
  await bestaetigeAnmeldung(pool, b2.anmeldung.id, 'sk');
  await referentZuweisen(pool, dBef.kurstage[0].id, { referentId: refExtern.id, rolle: 'Referentin' });

  const dSaq = await createDurchfuehrung(pool, { kursangebotId: saqv.id, startDatum: werktag(35), endDatum: werktag(35), ort: 'Zürich', kapazitaet: 12, projektId: p3.id });
  await setDurchfuehrungStatus(pool, dSaq.id, 'ausgeschrieben', 'sk');
  for (const k of [claudia, eva, oliver]) await meldeAn(pool, dSaq.id, { kontaktId: k.id });
  const fueStart = werktag(60);
  await createDurchfuehrung(pool, { kursangebotId: fue.id, startDatum: fueStart, endDatum: folgeWerktag(folgeWerktag(fueStart)), ort: 'Luzern', kapazitaet: 10, projektId: p3.id, preisChf: 2250 });

  // Zertifizierung, die bald ablaeuft (Rezertifizierung faellig)
  await createLernnachweis(pool, { kontaktId: claudia.id, datum: tag(-200), titel: 'Fachtagung Anlageberatung (extern)', lernstunden: 6 });
  await createZertifizierung(pool, { kontaktId: claudia.id, typ: 'SAQ Kundenberater Bank (PK)', zertifikatNr: 'SAQ-PK-DEMO-001', ausgestelltAm: tag(-32 * 30), gueltigBis: tag(110) });
  await createZertifizierung(pool, { kontaktId: eva.id, typ: 'SAQ Kundenberater Bank (IK)', zertifikatNr: 'SAQ-IK-DEMO-002', ausgestelltAm: tag(-300) });

  // --- SAQ-Vorgaenge: zertifiziert, schriftlich bestanden mit Wiederholung, frisch angemeldet ------------
  const saqOliver = await createSaqFall(pool, { kontaktId: oliver.id, organisationId: beispielsee.org.id, rechnungsempfaengerId: beispielsee.ag.id,
    profil: 'IK', umfang: 'gesamtpaket', sprache: 'DE', rolle: 'Kundenberater', einwilligungRechnungBank: true }, 'sk');
  const weOliver = await planePruefung(pool, saqOliver.id, { art: 'schriftlich', teil: 1, datum: tag(-90), ort: 'Zürich' }, 'sk');
  await erfasseResultat(pool, weOliver.id, { resultatProzent: 82 }, 'sk');
  await setzeArbeitgeberbestaetigung(pool, saqOliver.id, tag(-80), 'sk');
  const oeOliver = await planePruefung(pool, saqOliver.id, { art: 'muendlich', teil: 1, datum: tag(-45), ort: 'St. Gallen', experte1Id: refExtern.id, experte2Id: refIntern.id }, 'sk');
  await erfasseResultat(pool, oeOliver.id, { resultatProzent: 76 }, 'sk');
  await stelleZertifikatAus(pool, saqOliver.id, { zertifikatNr: 'SAQ-IK-DEMO-003', ausgestelltAm: tag(-40) }, 'sk');

  const saqNina = await createSaqFall(pool, { kontaktId: nina.id, organisationId: musterbank.org.id, rechnungsempfaengerId: musterbank.ag.id,
    profil: 'AFFL', umfang: 'gesamtpaket', sprache: 'DE', rolle: 'Kundenberaterin', einwilligungRechnungBank: true }, 'sk');
  const we1Nina = await planePruefung(pool, saqNina.id, { art: 'schriftlich', teil: 1, datum: tag(-70), ort: 'Zürich' }, 'sk');
  await erfasseResultat(pool, we1Nina.id, { resultatProzent: 74 }, 'sk');
  const we2Nina = await planePruefung(pool, saqNina.id, { art: 'schriftlich', teil: 2, datum: tag(-70), ort: 'Zürich' }, 'sk');
  await erfasseResultat(pool, we2Nina.id, { resultatProzent: 61 }, 'sk');
  await planePruefung(pool, saqNina.id, { art: 'schriftlich', teil: 2, datum: werktag(42), ort: 'Zürich' }, 'sk');

  await createSaqFall(pool, { kontaktId: claudia.id, organisationId: musterbank.org.id, rechnungsempfaengerId: musterbank.ag.id,
    profil: 'AFFL', variante: 'erstzertifizierung', umfang: 'gesamtpaket', sprache: 'DE', rolle: 'Kundenberaterin', einwilligungRechnungBank: true,
    bemerkung: 'Aufstieg von PK (Zertifikat laeuft bald ab)' }, 'sk');

  // --- Rechnungen: festgeschrieben mit Teilzahlung (ueberfaellig), bezahlt, Entwurf -----------------
  const r1 = await zeitVerrechnen(pool, p1.id, { datum: tag(-40), bis: tag(-41), mwstSatz: 8.1, gruppierung: 'mitarbeitende' }, { benutzer: 'ml' });
  await festschreiben(pool, r1.rechnung.id, 'ml');
  await erfasseZahlung(pool, r1.rechnung.id, { datum: tag(-10), betrag: 2000, bemerkung: 'Teilzahlung', erfasstDurch: 'ml' });
  const r2 = await zeitVerrechnen(pool, p2.id, { datum: tag(-20), bis: tag(-21), mwstSatz: 8.1, gruppierung: 'taetigkeit' }, { benutzer: 'ml' });
  const r2fest = await festschreiben(pool, r2.rechnung.id, 'ml');
  await erfasseZahlung(pool, r2.rechnung.id, { datum: tag(-8), betrag: r2fest.totalBrutto, erfasstDurch: 'ml' });
  await zeitVerrechnen(pool, p2.id, { datum: HEUTE, bis: tag(-15), mwstSatz: 8.1, gruppierung: 'einzeln' }, { benutzer: 'ml' });

  // --- Integration: API-Client fuer die Homepage (Schluessel wird nicht ausgegeben) ------------------
  await createApiClient(pool, { name: 'Homepage (Demo)', scopes: ['public:read', 'public:anmeldung', 'public:anfrage'], erlaubteOrigins: ['https://www.example.ch'] });

  log(`Demo-Daten angelegt (Stichtag ${HEUTE}): 3 Mitarbeitende, 7 Organisationen, 16 Kontakte, 4 Projekte, 3 Kursangebote, 4 Durchfuehrungen, 3 SAQ-Vorgaenge, 3 Rechnungen.`);
  log('Anmeldung im Dev-Modus z. B. als ml (Admin) oder ph/sk (Standard).');
  return true;
}

// CLI: `npm run seed:demo`
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const pool = getPool();
  try {
    await runMigrations(pool);
    await seedDemo(pool);
  } catch (e) {
    console.error('Demo-Daten fehlgeschlagen:', e);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
