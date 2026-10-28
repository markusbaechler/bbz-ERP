import type pg from 'pg';
import { parseCamt054, lfdNrAusQrr } from '../domain/camt054';
import { ValidationError, NotFoundError } from '../domain/errors';
import { erfasseZahlung } from './debitorRepo';

export type Camt054Ergebnis = {
  verbucht: { rechnungId: string; nummer: string; betrag: number; datum: string; rechnungStatus: string; offen: number }[];
  bereitsVerbucht: number;
  nichtZugeordnet: { referenz: string | null; betrag: number; datum: string; mitteilung: string | null; grund: string }[];
  belastungenIgnoriert: number;
};

/**
 * Verbucht die Gutschriften einer camt.054-Datei auf die Rechnungen (Zuordnung ueber die QR-Referenz = lfd_nr).
 * Jede Zahlung laeuft in ihrer eigenen Transaktion (erfasseZahlung): Eine nicht zuordenbare Zahlung haelt die
 * uebrigen nicht auf. Idempotent ueber die Bankreferenz; ohne Bankreferenz dient Referenz+Datum+Betrag als Schluessel.
 */
export async function verbucheCamt054(pool: pg.Pool, inhalt: string, erfasstDurch: string | null): Promise<Camt054Ergebnis> {
  const e: Camt054Ergebnis = { verbucht: [], bereitsVerbucht: 0, nichtZugeordnet: [], belastungenIgnoriert: 0 };
  for (const b of parseCamt054(inhalt)) {
    if (!b.gutschrift) { e.belastungenIgnoriert++; continue; }
    const offen = (grund: string) => e.nichtZugeordnet.push({ referenz: b.referenz, betrag: b.betrag, datum: b.datum, mitteilung: b.mitteilung, grund });
    if (b.waehrung !== 'CHF') { offen(`Waehrung ${b.waehrung}`); continue; }
    if (!b.referenz) { offen('keine QR-Referenz'); continue; }
    const lfdNr = lfdNrAusQrr(b.referenz);
    const r = lfdNr === null ? null : (await pool.query("select id, nummer from rechnung where lfd_nr=$1 and typ <> 'gutschrift'", [lfdNr])).rows[0];
    if (!r) { offen('keine Rechnung zur Referenz'); continue; }
    const schluessel = b.bankReferenz ?? `${b.referenz}|${b.datum}|${b.betrag.toFixed(2)}`;
    if ((await pool.query('select 1 from zahlungseingang where bank_referenz=$1', [schluessel])).rowCount) { e.bereitsVerbucht++; continue; }
    try {
      const z = await erfasseZahlung(pool, r.id, { datum: b.datum, betrag: b.betrag, bemerkung: 'camt.054', erfasstDurch, bankReferenz: schluessel });
      e.verbucht.push({ rechnungId: r.id, nummer: r.nummer, betrag: b.betrag, datum: b.datum, rechnungStatus: z.rechnungStatus, offen: z.offen });
    } catch (err) {
      if ((err as any)?.code === '23505') { e.bereitsVerbucht++; continue; }   // parallel verbucht
      if (err instanceof ValidationError || err instanceof NotFoundError) { offen(err.message); continue; }
      throw err;
    }
  }
  return e;
}
