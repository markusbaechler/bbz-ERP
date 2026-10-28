// Sammelrechnung je Bank (loest "Rechnung Halbjahresrechnung" der FileMaker-Loesung ab).
import type { Rechnung, Rechnungsposition } from '../domain/types';
import { VERRECHENBAR } from '../domain/bildungTypes';
import { pruefeDatum } from '../domain/kursplanung';
import { ValidationError } from '../domain/errors';
import { rappenRunden } from '../domain/mwst';
import { type Db, num } from './db';
import { createRechnung, addPosition, getRechnung, listPositionen } from './rechnungRepo';
import { getProjektById } from './projektRepo';
import { audit } from './auditRepo';
import { mitTransaktion, sperreDurchfuehrung, type GesperrteDurchfuehrung } from './durchfuehrungRepo';
import { kursText, nebenkostenFuer } from './bildungVerrechnungRepo';

export type SammelZeitraum = { von: string; bis: string; auftraggeberId?: string | null };
type OhneEmpfaenger = { anmeldungId: string; name: string; durchfuehrungCode: string | null };
export type SammelVorschau = {
  empfaenger: { auftraggeberId: string; name: string; anmeldungen: number; betragChf: number }[];
  ohneEmpfaenger: OhneEmpfaenger[];
  ohneProjekt: OhneEmpfaenger[];
};
export type SammelErgebnis = {
  rechnungen: (Rechnung & { positionen: Rechnungsposition[] })[];
  verrechneteAnmeldungen: string[];
  ohneEmpfaenger: OhneEmpfaenger[];
  ohneProjekt: OhneEmpfaenger[];
};

type Offen = {
  id: string; status: string; preisChf: number | null; gebuehrChf: number | null; referenz: string | null; name: string;
  durchfuehrungId: string; code: string | null; projektId: string | null; empfaengerId: string | null; empfaengerName: string | null;
};

function pruefeZeitraum(z: SammelZeitraum): void {
  pruefeDatum(z?.von, 'von'); pruefeDatum(z?.bis, 'bis');
  if (z.bis < z.von) throw new ValidationError(`Zeitraum ungueltig: ${z.bis} liegt vor ${z.von}`);
}

/*
 * Offene Anmeldungen der Kurse, die im Zeitraum beginnen. Empfaenger = gesetzter Rechnungsempfaenger, sonst der Debitor
 * der Organisation der Person (Bank). Firmenkurse (Durchfuehrung mit Auftraggeber -> Pauschale) sind ausgenommen.
 */
async function offeneAnmeldungen(db: Db, z: SammelZeitraum, nurDurchfuehrungen?: string[]): Promise<Offen[]> {
  const args: unknown[] = [z.von, z.bis, VERRECHENBAR];
  let filter = '';
  if (z.auftraggeberId) { args.push(z.auftraggeberId); filter += ` and coalesce(a.rechnungsempfaenger_id, ago.id) = $${args.length}`; }
  if (nurDurchfuehrungen) { args.push(nurDurchfuehrungen); filter += ` and a.durchfuehrung_id = any($${args.length})`; }
  const r = await db.query(
    `select a.id, a.status, a.preis_chf, a.stornogebuehr_chf, a.rechnungsreferenz, a.durchfuehrung_id, d.code, d.projekt_id,
            trim(concat_ws(' ', k.vorname, k.nachname)) as name, coalesce(a.rechnungsempfaenger_id, ago.id) as empfaenger_id,
            ag.name as empfaenger_name
     from anmeldung a
       join kontakt k on k.id=a.kontakt_id
       join durchfuehrung d on d.id=a.durchfuehrung_id
       left join auftraggeber ago on ago.organisation_id = k.organisation_id and ago.aktiv
       left join auftraggeber ag on ag.id = coalesce(a.rechnungsempfaenger_id, ago.id)
     where a.rechnung_id is null and d.auftraggeber_id is null and d.start_datum between $1 and $2
       and (a.status = any($3) or (a.status='storniert' and a.stornogebuehr_chf > 0)) ${filter}
     order by d.start_datum, d.code, (a.status='storniert'), lower(k.nachname), lower(coalesce(k.vorname,'')), a.id`, args);
  return r.rows.map((x: any) => ({
    id: x.id, status: x.status, preisChf: num(x.preis_chf), gebuehrChf: num(x.stornogebuehr_chf), referenz: x.rechnungsreferenz,
    name: x.name, durchfuehrungId: x.durchfuehrung_id, code: x.code, projektId: x.projekt_id, empfaengerId: x.empfaenger_id,
    empfaengerName: x.empfaenger_name,
  }));
}

const betrag = (o: Offen) => (o.status === 'storniert' ? o.gebuehrChf : o.preisChf) ?? 0;
const ohne = (o: Offen): OhneEmpfaenger => ({ anmeldungId: o.id, name: o.name, durchfuehrungCode: o.code });

/** Was eine Sammelrechnung im Zeitraum ergaebe (Betrag ohne Nebenkosten und MWSt). */
export async function sammelrechnungVorschau(db: Db, z: SammelZeitraum): Promise<SammelVorschau> {
  pruefeZeitraum(z);
  const offen = await offeneAnmeldungen(db, z);
  const je = new Map<string, SammelVorschau['empfaenger'][number]>();
  for (const o of offen.filter((x) => x.empfaengerId && x.projektId)) {
    const e = je.get(o.empfaengerId!) ?? { auftraggeberId: o.empfaengerId!, name: o.empfaengerName ?? '', anmeldungen: 0, betragChf: 0 };
    e.anmeldungen++; e.betragChf = rappenRunden(e.betragChf + betrag(o));
    je.set(o.empfaengerId!, e);
  }
  return {
    empfaenger: [...je.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    ohneEmpfaenger: offen.filter((o) => !o.empfaengerId).map(ohne),
    ohneProjekt: offen.filter((o) => o.empfaengerId && !o.projektId).map(ohne),
  };
}

/**
 * Verrechnet den Zeitraum atomar: je Empfaenger und Projekt (Kostentraeger, bestimmt die Rechnungsnummer) ein
 * Rechnungsentwurf mit den Positionen wie bei der Verrechnung je Durchfuehrung (Kurs, Annullationskosten, Nebenkosten).
 * Die beteiligten Durchfuehrungen werden in fester Reihenfolge gesperrt; danach werden die offenen Anmeldungen neu
 * gelesen, sodass parallele Laeufe nichts doppelt verrechnen.
 */
export async function verrechneSammelrechnung(db: Db, input: SammelZeitraum & { datum: string }, benutzer: string | null = null): Promise<SammelErgebnis> {
  pruefeZeitraum(input);
  const datum = pruefeDatum(input?.datum, 'datum');
  const kandidaten = [...new Set((await offeneAnmeldungen(db, input)).map((o) => o.durchfuehrungId))].sort();
  return mitTransaktion(db, async (c) => {
    const durchfuehrungen = new Map<string, GesperrteDurchfuehrung>();
    for (const id of kandidaten) durchfuehrungen.set(id, await sperreDurchfuehrung(c, id));
    const offen = kandidaten.length ? await offeneAnmeldungen(c, input, kandidaten) : [];
    const verrechenbar = offen.filter((o) => o.empfaengerId && o.projektId);

    const gruppen = new Map<string, Offen[]>();
    for (const o of verrechenbar) { const k = `${o.empfaengerId}|${o.projektId}`; gruppen.set(k, [...(gruppen.get(k) ?? []), o]); }
    const sortiert = [...gruppen.values()].sort((x, y) =>
      (x[0].empfaengerName ?? '').localeCompare(y[0].empfaengerName ?? '', 'de') || x[0].projektId!.localeCompare(y[0].projektId!));

    const nebenkosten = new Map<string, Awaited<ReturnType<typeof nebenkostenFuer>>>();
    const betreff = `Sammelrechnung Kurse ${chDatum(input.von)} – ${chDatum(input.bis)}`;
    const rechnungIds: string[] = [];
    for (const gruppe of sortiert) {
      const projekt = await getProjektById(c, gruppe[0].projektId!);
      const rechnung = await createRechnung(c, { projektId: projekt.id, auftraggeberId: gruppe[0].empfaengerId!, datum, betreff, mwstModus: projekt.mwstModus });
      for (const o of gruppe) {
        const d = durchfuehrungen.get(o.durchfuehrungId)!;
        const kurs = kursText(d);
        const ref = o.referenz ? ` (Ref. ${o.referenz})` : '';
        const position = (beschreibung: string, einzelpreis: number) =>
          ({ beschreibung, menge: 1, einheit: 'Pauschal', einzelpreis, mwstSatz: d.mwstSatz, kontoId: d.ertragskontoId });
        await addPosition(c, rechnung.id, o.status === 'storniert'
          ? position(`Annullationskosten ${kurs} – ${o.name}${ref}`, o.gebuehrChf ?? 0)
          : position(`${kurs} – ${o.name}${ref}`, o.preisChf ?? 0));
        if (!nebenkosten.has(d.id)) nebenkosten.set(d.id, await nebenkostenFuer(c, d.id));
        const nk = nebenkosten.get(d.id);
        if (nk && o.status !== 'storniert') {
          await addPosition(c, rechnung.id, { beschreibung: `Nebenkosten (Verpflegung/Infrastruktur) ${d.code} – ${o.name}`,
            menge: nk.tage, einheit: 'Tag', einzelpreis: nk.proTag, mwstSatz: nk.mwstSatz, kontoId: d.ertragskontoId });
        }
      }
      await c.query('update anmeldung set rechnung_id=$1 where id = any($2)', [rechnung.id, gruppe.map((o) => o.id)]);
      await audit(c, { benutzer, aktion: 'sammelrechnung', entitaet: 'rechnung', entitaetId: rechnung.id,
        details: { von: input.von, bis: input.bis, anmeldungIds: gruppe.map((o) => o.id) } });
      rechnungIds.push(rechnung.id);
    }
    const rechnungen: SammelErgebnis['rechnungen'] = [];
    for (const id of rechnungIds) rechnungen.push({ ...await getRechnung(c, id), positionen: await listPositionen(c, id) });
    return {
      rechnungen, verrechneteAnmeldungen: verrechenbar.map((o) => o.id),
      ohneEmpfaenger: offen.filter((o) => !o.empfaengerId).map(ohne),
      ohneProjekt: offen.filter((o) => o.empfaengerId && !o.projektId).map(ohne),
    };
  });
}

const chDatum = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
