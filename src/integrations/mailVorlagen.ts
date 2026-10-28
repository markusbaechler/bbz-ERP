import type pg from 'pg';
import type { Mail } from './mail';
import { getRechnung, listPositionen } from '../repos/rechnungRepo';
import { getAuftraggeberById } from '../repos/auftraggeberRepo';
import { erzeugeRechnungPdf } from '../pdf/rechnungPdf';

/*
 * Mail-Vorlagen. Die Outbox speichert nur Vorlage + IDs; Inhalte werden erst beim Versand aus der DB gelesen
 * (aktueller Stand, keine Personendaten in der Outbox).
 */

const ABSENDER_NAME = 'Bankenberatungszentrum, bbz st.gallen ag';
const FUSS = `\n\nFreundliche Grüsse\n${ABSENDER_NAME}\nZürcherstrasse 202, 9014 St. Gallen · 071 274 02 40`;

const chf = (n: number) => `CHF ${n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const datumCh = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
const anrede = (k: { anrede: string | null; vorname: string | null; nachname: string }) =>
  k.anrede === 'Frau' ? `Sehr geehrte Frau ${k.nachname}` : k.anrede === 'Herr' ? `Sehr geehrter Herr ${k.nachname}` : `Guten Tag ${[k.vorname, k.nachname].filter(Boolean).join(' ')}`;

async function anmeldungDaten(pool: pg.Pool, anmeldungId: string) {
  const r = await pool.query(
    `select a.status, a.wartelisten_position, k.anrede, k.vorname, k.nachname, k.email,
            coalesce(d.titel, ka.titel) as kurs, d.code, d.start_datum, d.end_datum, d.ort
     from anmeldung a join kontakt k on k.id=a.kontakt_id join durchfuehrung d on d.id=a.durchfuehrung_id
     join kursangebot ka on ka.id=d.kursangebot_id where a.id=$1`, [anmeldungId]);
  if (!r.rowCount) throw new Error(`Anmeldung ${anmeldungId} nicht gefunden`);
  const tage = await pool.query(
    `select t.datum, t.von, t.bis, t.ort from kurstag t join anmeldung a on a.durchfuehrung_id=t.durchfuehrung_id
     where a.id=$1 order by t.datum, t.von`, [anmeldungId]);
  return { ...r.rows[0], kurstage: tage.rows };
}

const termine = (a: any) => a.kurstage.length
  ? a.kurstage.map((t: any) => `- ${datumCh(t.datum)}${t.von ? `, ${String(t.von).slice(0, 5)}–${String(t.bis ?? '').slice(0, 5)}` : ''}${t.ort ?? a.ort ? `, ${t.ort ?? a.ort}` : ''}`).join('\n')
  : `- ${datumCh(a.start_datum)} bis ${datumCh(a.end_datum)}${a.ort ? `, ${a.ort}` : ''}`;

type Vorlage = (pool: pg.Pool, daten: any, an: string | null) => Promise<Mail>;

const VORLAGEN: Record<string, Vorlage> = {
  async anmeldebestaetigung(pool, daten, an) {
    const a = await anmeldungDaten(pool, daten.anmeldungId);
    return {
      an: an ?? a.email, betreff: `Anmeldebestätigung: ${a.kurs} (${a.code ?? datumCh(a.start_datum)})`,
      text: `${anrede(a)}\n\nWir bestätigen Ihre Anmeldung zu «${a.kurs}».\n\nTermine:\n${termine(a)}\n\n`
        + `Den Zugang zur Lernplattform mybbz erhalten Sie rechtzeitig vor Kursbeginn. Eine Abmeldung ist bis 30 Tage vor Kursbeginn kostenlos; danach wird der volle Kurspreis verrechnet (AGB). Eine Ersatzperson ist jederzeit möglich.${FUSS}`,
    };
  },
  async warteliste(pool, daten, an) {
    const a = await anmeldungDaten(pool, daten.anmeldungId);
    return {
      an: an ?? a.email, betreff: `Warteliste: ${a.kurs}`,
      text: `${anrede(a)}\n\nDer Kurs «${a.kurs}» ist ausgebucht. Wir haben Sie auf die Warteliste gesetzt${a.wartelisten_position ? ` (Position ${a.wartelisten_position})` : ''} und melden uns, sobald ein Platz frei wird.${FUSS}`,
    };
  },
  async nachgerueckt(pool, daten, an) {
    const a = await anmeldungDaten(pool, daten.anmeldungId);
    return {
      an: an ?? a.email, betreff: `Platz frei: ${a.kurs}`,
      text: `${anrede(a)}\n\nFür «${a.kurs}» ist ein Platz frei geworden. Sie sind von der Warteliste nachgerückt.\n\nTermine:\n${termine(a)}${FUSS}`,
    };
  },
  async mahnung(pool, daten, an) {
    const r = await pool.query(
      `select r.nummer, r.datum, r.total_brutto, ag.name, ag.email, m.stufe, m.frist_bis, m.gebuehr_chf, m.offen_chf
       from rechnung r join auftraggeber ag on ag.id=r.auftraggeber_id
       left join mahnung m on m.rechnung_id=r.id and m.stufe=$2 where r.id=$1`, [daten.rechnungId, daten.stufe]);
    if (!r.rowCount) throw new Error(`Rechnung ${daten.rechnungId} nicht gefunden`);
    const x = r.rows[0];
    const titel = Number(x.stufe) === 1 ? 'Zahlungserinnerung' : `${x.stufe}. Mahnung`;
    const gebuehr = Number(x.gebuehr_chf ?? 0);
    return {
      an: an ?? x.email, betreff: `${titel}: Rechnung ${x.nummer}`,
      text: `Guten Tag\n\nGemäss unserer Buchhaltung ist die Rechnung ${x.nummer} vom ${datumCh(x.datum)} über ${chf(Number(x.total_brutto))} `
        + `noch mit ${chf(Number(x.offen_chf ?? x.total_brutto))} offen. Wir bitten Sie, den Betrag bis ${x.frist_bis ? datumCh(x.frist_bis) : 'in 10 Tagen'} zu überweisen`
        + `${gebuehr > 0 ? `; für diese Mahnung verrechnen wir eine Gebühr von ${chf(gebuehr)} (AGB)` : ''}. Sollte sich Ihre Zahlung mit diesem Schreiben gekreuzt haben, betrachten Sie es bitte als gegenstandslos.${FUSS}`,
    };
  },
  // Rechnung als QR-PDF (FileMaker "Rechnung Mail"); das PDF entsteht erst beim Versand aus dem festgeschriebenen Beleg.
  async rechnung(pool, daten, an) {
    const rechnung = await getRechnung(pool, daten.rechnungId);
    const auftraggeber = await getAuftraggeberById(pool, rechnung.auftraggeberId);
    const frist = Number((await pool.query('select zahlungsfrist_tage from rechnung where id=$1', [rechnung.id])).rows[0]?.zahlungsfrist_tage ?? 30);
    const pdf = await erzeugeRechnungPdf(rechnung, await listPositionen(pool, rechnung.id), auftraggeber);
    return {
      an: an ?? auftraggeber.email ?? '', betreff: `Rechnung ${rechnung.nummer}`,
      text: `Guten Tag\n\nIm Anhang erhalten Sie unsere Rechnung ${rechnung.nummer} vom ${datumCh(rechnung.datum)} über ${chf(rechnung.totalBrutto)}`
        + `${rechnung.betreff ? ` (${rechnung.betreff})` : ''}. Bitte bezahlen Sie den Betrag innert ${frist} Tagen mit dem QR-Zahlteil.${FUSS}`,
      anhaenge: [{ name: `Rechnung_${String(rechnung.nummer).replace(/[^\w.-]+/g, '_')}.pdf`, typ: 'application/pdf', inhalt: pdf }],
    };
  },
};

export const VORLAGEN_NAMEN = Object.keys(VORLAGEN);

export async function rendereMail(pool: pg.Pool, vorlage: string, daten: Record<string, unknown>, an: string | null = null): Promise<Mail> {
  const v = VORLAGEN[vorlage];
  if (!v) throw new Error(`Unbekannte Mail-Vorlage: ${vorlage}`);
  const mail = await v(pool, daten, an);
  if (!mail.an) throw new Error(`Mail "${vorlage}" ohne Empfaenger (keine E-Mail hinterlegt)`);
  return mail;
}
