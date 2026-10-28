// Reine Cockpit-Berechnung (Spec v2 §5.3) aus Rohsummen der Datenbank.
import type { Ampel, Cockpit } from './pmTypes';

/**
 * Ampel-Regel [Entscheid Spec §5.3]:
 *   Budgetverbrauch = (leistungenChf + honorareChf) / budgetChf
 *     leistungenChf = verrechenbare Stunden x Ansatz (eigene Leistungen zum Verkaufswert, verrechnet oder nicht)
 *     honorareChf   = Honorare der nicht abgesagten Einsaetze (Fremdkosten Referent:innen)
 *   ("Kosten + Leistungen vs. Budget"; interne Kosten werden nicht zusaetzlich gezaehlt, sonst waeren
 *    dieselben Stunden doppelt im Verbrauch.)
 *   rot  = Budgetverbrauch > 100 %  oder  ein offener Meilenstein ist > 14 Tage ueberfaellig
 *   gelb = Budgetverbrauch > 85 %   oder  ein offener Meilenstein ist ueberfaellig (faellig_am < heute)
 *   sonst gruen. Ohne Budget (null/0) entfaellt das Budgetkriterium.
 */
export const AMPEL_REGEL = { rotBudgetProzent: 100, gelbBudgetProzent: 85, rotVerzugTage: 14 } as const;

export type CockpitRoh = {
  projektId: string;
  budgetChf: number | null; budgetStunden: number | null; aufwandBudgetChf: number | null;
  abgerechnetChf: number; leistungenChf: number; unverrechnetChf: number;
  stundenIst: number; stundenVerrechenbar: number; internKostenChf: number; honorareChf: number;
  /** Aufgaben des Projekts ohne abgebrochene */
  aufgaben: { total: number; erledigt: number };
  meilensteine: { titel: string; faelligAm: string; erreichtAm: string | null }[];
};

const runde2 = (x: number): number => Math.round(x * 100) / 100;
const runde1 = (x: number): number => Math.round(x * 10) / 10;

const utcTag = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Kalendertage von `von` bis `bis` (YYYY-MM-DD), zeitzonenunabhaengig. */
export function tageZwischen(von: string, bis: string): number {
  return Math.round((utcTag(bis) - utcTag(von)) / 86_400_000);
}

/** Heutiges Datum in Europe/Zurich als YYYY-MM-DD. */
export function heuteIso(jetzt: Date = new Date()): string {
  const teile = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(jetzt);
  const t = (typ: Intl.DateTimeFormatPartTypes) => teile.find((x) => x.type === typ)?.value ?? '';
  return `${t('year')}-${t('month')}-${t('day')}`;
}

export function bewerteAmpel(p: { verbrauchChf: number; budgetChf: number | null; verzuege: { titel: string; tage: number }[] }): { ampel: Ampel; gruende: string[] } {
  const rot: string[] = []; const gelb: string[] = [];
  for (const v of [...p.verzuege].sort((a, b) => b.tage - a.tage)) {
    if (v.tage > AMPEL_REGEL.rotVerzugTage) rot.push(`Meilenstein "${v.titel}" ${v.tage} Tage ueberfaellig (> ${AMPEL_REGEL.rotVerzugTage})`);
    else if (v.tage > 0) gelb.push(`Meilenstein "${v.titel}" ${v.tage} ${v.tage === 1 ? 'Tag' : 'Tage'} ueberfaellig`);
  }
  if (p.budgetChf !== null && p.budgetChf > 0) {
    // Vergleich in ganzen Rappen, damit Grenzwerte (genau 85 % / 100 %) nicht an Fliesskomma scheitern
    const verbrauchRp = Math.round(p.verbrauchChf * 100); const budgetRp = Math.round(p.budgetChf * 100);
    const prozent = runde1((p.verbrauchChf / p.budgetChf) * 100).toFixed(1);
    if (verbrauchRp * 100 > budgetRp * AMPEL_REGEL.rotBudgetProzent) rot.push(`Budgetverbrauch ${prozent} % (> ${AMPEL_REGEL.rotBudgetProzent} %)`);
    else if (verbrauchRp * 100 > budgetRp * AMPEL_REGEL.gelbBudgetProzent) gelb.push(`Budgetverbrauch ${prozent} % (> ${AMPEL_REGEL.gelbBudgetProzent} %)`);
  }
  const ampel: Ampel = rot.length ? 'rot' : gelb.length ? 'gelb' : 'gruen';
  return { ampel, gruende: [...rot, ...gelb] };
}

export function berechneCockpit(roh: CockpitRoh, heute: string): Cockpit {
  const verbrauchChf = roh.leistungenChf + roh.honorareChf;
  const offen = roh.meilensteine.filter((m) => !m.erreichtAm);
  const verzuege = offen.filter((m) => m.faelligAm < heute).map((m) => ({ titel: m.titel, tage: tageZwischen(m.faelligAm, heute) }));
  const { ampel, gruende } = bewerteAmpel({ verbrauchChf, budgetChf: roh.budgetChf, verzuege });
  return {
    projektId: roh.projektId,
    budgetChf: roh.budgetChf, budgetStunden: roh.budgetStunden, aufwandBudgetChf: roh.aufwandBudgetChf,
    abgerechnetChf: runde2(roh.abgerechnetChf), leistungenChf: runde2(roh.leistungenChf), unverrechnetChf: runde2(roh.unverrechnetChf),
    stundenIst: runde2(roh.stundenIst), stundenVerrechenbar: runde2(roh.stundenVerrechenbar),
    internKostenChf: runde2(roh.internKostenChf), honorareChf: runde2(roh.honorareChf),
    deckungsbeitragChf: runde2(roh.abgerechnetChf - roh.internKostenChf - roh.honorareChf),
    budgetverbrauchProzent: roh.budgetChf ? runde1((verbrauchChf / roh.budgetChf) * 100) : null,
    stundenverbrauchProzent: roh.budgetStunden ? runde1((roh.stundenIst / roh.budgetStunden) * 100) : null,
    fortschritt: {
      total: roh.aufgaben.total, erledigt: roh.aufgaben.erledigt,
      prozent: roh.aufgaben.total ? Math.round((roh.aufgaben.erledigt / roh.aufgaben.total) * 100) : 0,
    },
    meilensteine: {
      total: roh.meilensteine.length, erreicht: roh.meilensteine.length - offen.length,
      ueberfaellig: verzuege.length, maxVerzugTage: verzuege.reduce((m, v) => Math.max(m, v.tage), 0),
    },
    ampel, ampelGruende: gruende,
  };
}
