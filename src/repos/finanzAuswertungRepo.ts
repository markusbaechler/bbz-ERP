// Kontenauswertung (loest "ER-Konti", "ER-nach Kunde", "Aufw.-Konti" und den Druck aus pos_fak_konti der FileMaker-Loesung ab).
import { pruefeDatum, pruefeZeitraum } from '../domain/pmTypes';
import { rappenRunden } from '../domain/mwst';
import type { Db } from './db';

export type KontenAuswertung = {
  von: string; bis: string;
  ertrag: { kontoNummer: string | null; bezeichnung: string | null; nettoChf: number }[];
  ertragJeAuftraggeber: { kontoNummer: string | null; auftraggeberId: string; auftraggeber: string; nettoChf: number }[];
  aufwand: { kontoNummer: string | null; bezeichnung: string | null; honorarChf: number }[];
};

/*
 * Ertrag: Nettobetraege der Positionen festgeschriebener Rechnungen nach Rechnungsdatum. Stornierte Rechnungen
 * zaehlen mit, ihre Gutschrift (gespiegelte Positionen, Datum = Storno) hebt sie auf. Positionen ohne Konto
 * erscheinen mit kontoNummer null. Aufwand: Honorare nicht abgesagter Einsaetze nach Aufwandkonto des Projekts.
 */
const ERTRAG_SQL = `
  from rechnungsposition p
  join rechnung r on r.id = p.rechnung_id
  left join konto k on k.id = p.konto_id
  where r.status in ('abgerechnet','bezahlt','storniert') and r.datum between $1 and $2`;

export async function kontenAuswertung(db: Db, z: { von: string; bis: string }): Promise<KontenAuswertung> {
  pruefeDatum('von', z.von, true); pruefeDatum('bis', z.bis, true); pruefeZeitraum(z.von, z.bis);
  const [ertrag, jeAg, aufwand] = await Promise.all([
    db.query(`select k.nummer, k.bezeichnung, sum(p.betrag_netto) as s ${ERTRAG_SQL}
              group by k.nummer, k.bezeichnung having sum(p.betrag_netto) <> 0 order by k.nummer nulls last`, [z.von, z.bis]),
    db.query(`select k.nummer, a.id as ag_id, a.name as ag_name, sum(p.betrag_netto) as s ${ERTRAG_SQL.replace('where', 'join auftraggeber a on a.id = r.auftraggeber_id where')}
              group by k.nummer, a.id, a.name having sum(p.betrag_netto) <> 0 order by k.nummer nulls last, a.name`, [z.von, z.bis]),
    db.query(`select k.nummer, k.bezeichnung, sum(coalesce(e.honorar_chf, 0)) as s
              from einsatz e join projekt pr on pr.id = e.projekt_id left join konto k on k.id = pr.aufwandkonto_id
              where e.status <> 'abgesagt' and e.datum between $1 and $2
              group by k.nummer, k.bezeichnung having sum(coalesce(e.honorar_chf, 0)) <> 0 order by k.nummer nulls last`, [z.von, z.bis]),
  ]);
  const chf = (v: unknown) => rappenRunden(Number(v));
  return {
    von: z.von, bis: z.bis,
    ertrag: ertrag.rows.map((r) => ({ kontoNummer: r.nummer, bezeichnung: r.bezeichnung, nettoChf: chf(r.s) })),
    ertragJeAuftraggeber: jeAg.rows.map((r) => ({ kontoNummer: r.nummer, auftraggeberId: r.ag_id, auftraggeber: r.ag_name, nettoChf: chf(r.s) })),
    aufwand: aufwand.rows.map((r) => ({ kontoNummer: r.nummer, bezeichnung: r.bezeichnung, honorarChf: chf(r.s) })),
  };
}
