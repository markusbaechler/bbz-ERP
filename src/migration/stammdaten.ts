import type pg from 'pg';
import { upsertKonto } from '../repos/kontoRepo';
import { upsertMwstSatz } from '../repos/mwstSatzRepo';

// Die im Projekt-Export belegten Konten (Befund B4).
// ACHTUNG: Die Bezeichnungen sind aus der Bereichs-Zuordnung des Exports abgeleitet
// und vor dem produktiven Lauf gegen den bbz-Kontenplan zu bestaetigen.
export const KONTENPLAN = [
  { nummer: '3010', bezeichnung: 'Ertrag Managementausbildung/IGK', typ: 'Ertrag' },
  { nummer: '3011', bezeichnung: 'Ertrag Leadership/Unternehmensentwicklung', typ: 'Ertrag' },
  { nummer: '3100', bezeichnung: 'Ertrag Banking', typ: 'Ertrag' },
  { nummer: '3101', bezeichnung: 'Ertrag Kundenberaterausbildung', typ: 'Ertrag' },
  { nummer: '3102', bezeichnung: 'Ertrag Banking (weitere)', typ: 'Ertrag' },
  { nummer: '3200', bezeichnung: 'Ertrag Lizenzierung', typ: 'Ertrag' },
  { nummer: '3204', bezeichnung: 'Ertrag Lizenzierung (weitere)', typ: 'Ertrag' },
  { nummer: '3700', bezeichnung: 'Uebriger Ertrag', typ: 'Ertrag' },
  { nummer: '5000', bezeichnung: 'Direkter Projektaufwand', typ: 'Aufwand' },
  { nummer: '5100', bezeichnung: 'Referentenaufwand', typ: 'Aufwand' },
  { nummer: '5200', bezeichnung: 'Uebriger Projektaufwand', typ: 'Aufwand' },
] as const satisfies ReadonlyArray<{ nummer: string; bezeichnung: string; typ: 'Ertrag' | 'Aufwand' }>;

// Schweizer MWSt-Satzhistorie. Deckt alle 12 im Faktura-Export vorkommenden Saetze ab
// (0, 2, 2.4, 2.5, 2.6, 3.6, 3.7, 3.8, 7.6, 7.7, 8, 8.1) — noetig, damit historische
// Belege beim spaeteren Rechnungsimport ihren gueltigen Satz finden.
export const MWST_SAETZE = [
  { satz: 0.0, bezeichnung: 'Befreit/ausgenommen', gueltigAb: '1995-01-01', gueltigBis: null },
  { satz: 2.0, bezeichnung: 'Reduziert', gueltigAb: '1995-01-01', gueltigBis: '1998-12-31' },
  { satz: 2.4, bezeichnung: 'Reduziert', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 2.5, bezeichnung: 'Reduziert', gueltigAb: '2011-01-01', gueltigBis: '2023-12-31' },
  { satz: 2.6, bezeichnung: 'Reduziert', gueltigAb: '2024-01-01', gueltigBis: null },
  { satz: 3.6, bezeichnung: 'Beherbergung', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2011-01-01', gueltigBis: '2017-12-31' },
  { satz: 3.7, bezeichnung: 'Beherbergung', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' },
  { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2024-01-01', gueltigBis: null },
  { satz: 7.6, bezeichnung: 'Normal', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 8.0, bezeichnung: 'Normal', gueltigAb: '2011-01-01', gueltigBis: '2017-12-31' },
  { satz: 7.7, bezeichnung: 'Normal', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' },
  { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01', gueltigBis: null },
] as const satisfies ReadonlyArray<{ satz: number; bezeichnung: string; gueltigAb: string; gueltigBis: string | null }>;

export async function importStammdaten(pool: pg.Pool): Promise<{
  konten: { angelegt: number; vorhanden: number };
  mwstSaetze: { angelegt: number; vorhanden: number };
}> {
  const konten = { angelegt: 0, vorhanden: 0 };
  for (const k of KONTENPLAN) {
    const r = await upsertKonto(pool, { nummer: k.nummer, bezeichnung: k.bezeichnung, typ: k.typ });
    r.neu ? konten.angelegt++ : konten.vorhanden++;
  }
  const mwstSaetze = { angelegt: 0, vorhanden: 0 };
  for (const s of MWST_SAETZE) {
    const r = await upsertMwstSatz(pool, s);
    r.neu ? mwstSaetze.angelegt++ : mwstSaetze.vorhanden++;
  }
  return { konten, mwstSaetze };
}
