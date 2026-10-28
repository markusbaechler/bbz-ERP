import type pg from 'pg';
import { grundbestand } from './helpers/fixtures';
import { createKonto } from '../src/repos/kontoRepo';
import { createKursangebot, type KursangebotInput } from '../src/repos/kursangebotRepo';
import { createDurchfuehrung, setDurchfuehrungStatus, type DurchfuehrungInput } from '../src/repos/durchfuehrungRepo';

/** Grundbestand + Ertragskonto Bildung fuer Bildungs-Tests. */
export async function bildungsbestand(pool: pg.Pool) {
  const base = await grundbestand(pool);
  const konto = await createKonto(pool, { nummer: '3400', bezeichnung: 'Ertrag Seminare', typ: 'Ertrag' });
  return { ...base, konto };
}

let lfd = 0;
export async function angebot(pool: pg.Pool, input: Partial<KursangebotInput> = {}) {
  lfd += 1;
  return createKursangebot(pool, {
    code: `K${lfd}`, titel: `Kurs ${lfd}`, bereich: 'Banking', preisChf: 1200, lernstunden: 8, ...input,
  });
}

/** Ausgeschriebene Durchfuehrung mit einem Kurstag (Default: ein Tag am 2026-12-01). */
export async function ausgeschrieben(pool: pg.Pool, kursangebotId: string, input: Partial<DurchfuehrungInput> = {}) {
  const d = await createDurchfuehrung(pool, {
    kursangebotId, startDatum: '2026-12-01', endDatum: '2026-12-01', ...input,
  });
  return setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben');
}
