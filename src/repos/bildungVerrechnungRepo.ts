import type { Rechnung, Rechnungsposition } from '../domain/types';
import { VERRECHENBAR } from '../domain/bildungTypes';
import { pruefeDatum } from '../domain/kursplanung';
import { ValidationError, ConflictError } from '../domain/errors';
import { type Db, num } from './db';
import { createRechnung, addPosition, getRechnung, listPositionen } from './rechnungRepo';
import { getProjektById } from './projektRepo';
import { audit } from './auditRepo';
import { mitTransaktion, sperreDurchfuehrung } from './durchfuehrungRepo';

/** 400 mit den betroffenen Anmeldungen, damit die Oberflaeche sie direkt zum Nachtragen anbieten kann. */
export class OhneRechnungsempfaengerError extends ValidationError {
  constructor(public readonly anmeldungIds: string[], namen: string[]) {
    super(`Anmeldungen ohne Rechnungsempfaenger: ${namen.join(', ')}`);
  }
}

export type VerrechnungInput = { datum: string; pauschalChf?: number | null };
export type VerrechnungErgebnis = {
  rechnungen: (Rechnung & { positionen: Rechnungsposition[] })[];
  verrechneteAnmeldungen: string[];
};

type Offen = {
  id: string; status: string; empfaengerId: string | null; empfaengerName: string | null; preisChf: number | null;
  gebuehrChf: number | null; referenz: string | null; name: string;
};

/**
 * Verrechnungslauf einer Durchfuehrung (Admin), atomar in einer Transaktion:
 * - Standard: je Rechnungsempfaenger ein Rechnungsentwurf im Projekt der Durchfuehrung; je Teilnehmer:in eine Position
 *   (Preis-Snapshot), je Storno mit Gebuehr eine Position "Annullationskosten"; MWSt-Satz und Ertragskonto aus dem
 *   Kursangebot. Bereits verrechnete Anmeldungen werden uebersprungen, Anmeldungen ohne Empfaenger -> 400.
 * - `pauschalChf` (Firmenkurs): eine Pauschalposition an den Auftraggeber der Durchfuehrung; deckt alle offenen
 *   Anmeldungen ab. Eine zweite Pauschale fuer dieselbe Durchfuehrung -> 409.
 */
export async function verrechneDurchfuehrung(db: Db, durchfuehrungId: string, input: VerrechnungInput, benutzer: string | null = null): Promise<VerrechnungErgebnis> {
  const datum = pruefeDatum(input?.datum, 'datum');
  const pauschal = input.pauschalChf ?? null;
  if (pauschal !== null && !(typeof pauschal === 'number' && pauschal > 0)) throw new ValidationError('pauschalChf muss > 0 sein');

  return mitTransaktion(db, async (c) => {
    // Sperre: parallele Laeufe fuer dieselbe Durchfuehrung warten und finden danach nichts Offenes mehr.
    const d = await sperreDurchfuehrung(c, durchfuehrungId);
    if (!d.projektId) throw new ValidationError(`Durchfuehrung ${d.code} hat kein Projekt (Kostentraeger) fuer die Verrechnung`);
    if (pauschal !== null && !d.auftraggeberId) throw new ValidationError('Pauschale verlangt einen Auftraggeber der Durchfuehrung (Firmenkurs)');
    const projekt = await getProjektById(c, d.projektId);
    const kurs = `Kurs ${d.titel ?? d.kursangebotTitel} ${d.code}`;
    const position = (beschreibung: string, einzelpreis: number) =>
      ({ beschreibung, menge: 1, einheit: 'Pauschal', einzelpreis, mwstSatz: d.mwstSatz, kontoId: d.ertragskontoId });
    // Nebenkosten (Verpflegung/Infrastruktur) je Teilnehmer:in und Kurstag, eigener MWSt-Satz (AGB: separat ausgewiesen)
    const nk = (await c.query(
      `select ka.nebenkosten_pro_tag_chf as satz, ka.nebenkosten_mwst_satz as mwst,
              greatest((select count(*) from kurstag t where t.durchfuehrung_id=d.id), 1)::int as tage
       from durchfuehrung d join kursangebot ka on ka.id=d.kursangebot_id where d.id=$1`, [d.id])).rows[0];
    const nebenkosten = nk?.satz !== null && Number(nk?.satz) > 0
      ? { proTag: Number(nk.satz), mwstSatz: Number(nk.mwst), tage: Number(nk.tage) } : null;
    const neueRechnung = (auftraggeberId: string) =>
      createRechnung(c, { projektId: projekt.id, auftraggeberId, datum, betreff: kurs, mwstModus: projekt.mwstModus });

    const r = await c.query(
      `select a.id, a.status, a.rechnungsempfaenger_id, ag.name as empfaenger_name, a.preis_chf, a.stornogebuehr_chf,
              a.rechnungsreferenz, trim(concat_ws(' ', k.vorname, k.nachname)) as name
       from anmeldung a join kontakt k on k.id=a.kontakt_id left join auftraggeber ag on ag.id=a.rechnungsempfaenger_id
       where a.durchfuehrung_id=$1 and a.rechnung_id is null
         and (a.status = any($2) or (a.status='storniert' and a.stornogebuehr_chf > 0))
       order by (a.status='storniert'), lower(k.nachname), lower(coalesce(k.vorname,'')), a.id`, [d.id, VERRECHENBAR]);
    const offen: Offen[] = r.rows.map((x: any) => ({
      id: x.id, status: x.status, empfaengerId: x.rechnungsempfaenger_id, empfaengerName: x.empfaenger_name,
      preisChf: num(x.preis_chf), gebuehrChf: num(x.stornogebuehr_chf), referenz: x.rechnungsreferenz, name: x.name,
    }));

    const rechnungIds: string[] = [];
    const verrechnet = async (rechnungId: string, anmeldungIds: string[]) => {
      if (anmeldungIds.length) await c.query('update anmeldung set rechnung_id=$1 where id = any($2)', [rechnungId, anmeldungIds]);
    };

    if (pauschal !== null) {
      const text = `Pauschale ${kurs}`;
      const schon = await c.query(
        `select 1 from rechnungsposition p join rechnung r on r.id=p.rechnung_id
         where r.projekt_id=$1 and r.status <> 'storniert' and p.beschreibung=$2`, [projekt.id, text]);
      if (schon.rowCount) throw new ConflictError(`Pauschale fuer ${d.code} ist bereits verrechnet`);
      const rechnung = await neueRechnung(d.auftraggeberId!);
      await addPosition(c, rechnung.id, position(text, pauschal));
      await verrechnet(rechnung.id, offen.map((o) => o.id));
      rechnungIds.push(rechnung.id);
    } else {
      const ohne = offen.filter((o) => !o.empfaengerId);
      if (ohne.length) throw new OhneRechnungsempfaengerError(ohne.map((o) => o.id), ohne.map((o) => o.name));
      const gruppen = new Map<string, Offen[]>();
      for (const o of offen) gruppen.set(o.empfaengerId!, [...(gruppen.get(o.empfaengerId!) ?? []), o]);
      const sortiert = [...gruppen.values()].sort((x, y) =>
        (x[0].empfaengerName ?? '').localeCompare(y[0].empfaengerName ?? '', 'de') || x[0].empfaengerId!.localeCompare(y[0].empfaengerId!));
      for (const gruppe of sortiert) {
        const rechnung = await neueRechnung(gruppe[0].empfaengerId!);
        for (const o of gruppe) {
          const ref = o.referenz ? ` (Ref. ${o.referenz})` : '';
          await addPosition(c, rechnung.id, o.status === 'storniert'
            ? position(`Annullationskosten ${kurs} – ${o.name}${ref}`, o.gebuehrChf ?? 0)
            : position(`${kurs} – ${o.name}${ref}`, o.preisChf ?? 0));
          if (nebenkosten && o.status !== 'storniert') {
            await addPosition(c, rechnung.id, { beschreibung: `Nebenkosten (Verpflegung/Infrastruktur) ${d.code} – ${o.name}`,
              menge: nebenkosten.tage, einheit: 'Tag', einzelpreis: nebenkosten.proTag, mwstSatz: nebenkosten.mwstSatz, kontoId: d.ertragskontoId });
          }
        }
        await verrechnet(rechnung.id, gruppe.map((o) => o.id));
        rechnungIds.push(rechnung.id);
      }
    }

    const anmeldungIds = offen.map((o) => o.id);
    if (rechnungIds.length) {
      await audit(c, { benutzer, aktion: 'verrechnung', entitaet: 'durchfuehrung', entitaetId: d.id,
        details: { datum, pauschalChf: pauschal, rechnungIds, anmeldungIds } });
    }
    const rechnungen: VerrechnungErgebnis['rechnungen'] = [];
    for (const id of rechnungIds) rechnungen.push({ ...await getRechnung(c, id), positionen: await listPositionen(c, id) });
    return { rechnungen, verrechneteAnmeldungen: anmeldungIds };
  });
}
