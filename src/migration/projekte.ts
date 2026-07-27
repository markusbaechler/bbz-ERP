import type pg from 'pg';
import type { ProjektGruppe } from './gruppen';
import type { MigrationProjektInput } from '../domain/types';
import { fmText, fmZahl, fmProjektNummer, fmBereich } from './normalize';
import { findKontoByNummer } from '../repos/kontoRepo';
import { upsertProjektAusMigration } from '../repos/projektRepo';

export type ProjektImportErgebnis = {
  gelesen: number; neu: number; aktualisiert: number; uebersprungen: number;
  csvSummen: { budgetChf: number; offenProv: number; abgerechnet: number };
  warnungen: string[];
};

export async function importProjekte(
  pool: pg.Pool,
  gruppen: ProjektGruppe[],
  idNachNummer: Map<string, string>,
): Promise<ProjektImportErgebnis> {
  const e: ProjektImportErgebnis = {
    gelesen: gruppen.length, neu: 0, aktualisiert: 0, uebersprungen: 0,
    csvSummen: { budgetChf: 0, offenProv: 0, abgerechnet: 0 }, warnungen: [],
  };
  // Kontonummer -> id (oder null fuer "nicht im Kontenplan"), einmal je Lauf aufgeloest
  const kontoCache = new Map<string, string | null>();
  const kontoId = async (nummer: string | null, projektNr: string, feld: string): Promise<string | null> => {
    if (nummer === null) return null;
    if (!kontoCache.has(nummer)) {
      const k = await findKontoByNummer(pool, nummer);
      kontoCache.set(nummer, k?.id ?? null);
    }
    const id = kontoCache.get(nummer)!;
    if (id === null) e.warnungen.push(`Projekt ${projektNr}: ${feld} "${nummer}" nicht im Kontenplan — Kontierung bleibt offen`);
    return id;
  };

  for (const g of gruppen) {
    const p = g.projekt;
    const projektNr = fmText(p['Projekt_Nr.']) ?? '(ohne Nr.)';
    const name = fmText(p['Projekt_Name']);
    const auftraggeberNr = fmText(p['Auftraggeber_Nr.']);
    const auftraggeberId = auftraggeberNr === null ? undefined : idNachNummer.get(auftraggeberNr);

    if (name === null) { e.uebersprungen++; e.warnungen.push(`Projekt ${projektNr}: ohne Projekt_Name uebersprungen`); continue; }
    if (!auftraggeberId) { e.uebersprungen++; e.warnungen.push(`Projekt ${projektNr}: Auftraggeber-Nr. "${auftraggeberNr}" nicht importiert — uebersprungen`); continue; }

    const { stammnummer, jahr } = fmProjektNummer(projektNr);
    const jahrSpalte = fmZahl(p['Jahr']);
    if (jahrSpalte !== null && jahrSpalte !== jahr) {
      e.warnungen.push(`Projekt ${projektNr}: Spalte Jahr=${jahrSpalte} weicht von der Nummer ab — ${jahr} verwendet`);
    }

    const budgetChf = fmZahl(p['Budget CHF']);
    const offenProv = fmZahl(p['offen_prov.']);
    const abgerechnet = fmZahl(p['abgerechnet']);

    const input: MigrationProjektInput = {
      stammnummer, jahr, name, auftraggeberId,
      kuerzel: fmText(p['Projekt_Kürzel']),
      bereich: fmBereich(p['Bereich']),
      beschrieb: fmText(p['Beschrieb']),
      ansprechperson: fmText(p['Ansprechperson']),
      ertragskontoId: await kontoId(fmText(p['Konto']), projektNr, 'Konto'),
      aufwandKontoId: await kontoId(fmText(p['Aufw. Konto']), projektNr, 'Aufw. Konto'),
      budgetChf, budgetTage: fmZahl(p['Budget Tage']),
      aufwandBudgetChf: fmZahl(p['Aufw. Budget CHF']),
      fmOffenProv: offenProv, fmAbgerechnet: abgerechnet,
      alteProjektNr: fmText(p['alte_Projekt_Nr']),
      projektleitungKuerzel: fmText(p['Referent intern']),
      mwstModus: (fmText(p['MWSt']) ?? '').toLowerCase().startsWith('inkl') ? 'inkl' : 'exkl',
      erstelltDurch: fmText(p['Erstellt durch']),
      geaendertDurch: fmText(p['geändert durch']),
    };

    const r = await upsertProjektAusMigration(pool, input);
    r.neu ? e.neu++ : e.aktualisiert++;
    e.csvSummen.budgetChf += budgetChf ?? 0;
    e.csvSummen.offenProv += offenProv ?? 0;
    e.csvSummen.abgerechnet += abgerechnet ?? 0;
  }

  e.csvSummen.budgetChf = Math.round(e.csvSummen.budgetChf * 100) / 100;
  e.csvSummen.offenProv = Math.round(e.csvSummen.offenProv * 100) / 100;
  e.csvSummen.abgerechnet = Math.round(e.csvSummen.abgerechnet * 100) / 100;
  return e;
}
