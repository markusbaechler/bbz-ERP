import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { rechnungZaehlerStand, setzeRechnungZaehler, type ZaehlerStand } from '../repos/zaehlerRepo';
import { rechnungNrUntergrenze, zaehlerGesperrt, UNTERGRENZE_ENV } from '../config/rechnungszaehler';
// Nur eine Validierung fuer denselben Parameter: dieselbe Funktion, die auch
// `npm run migrate:fm -- --rechnung-max=<n>` an der CLI-Grenze prueft.
import { parseRechnungMax } from '../migration/run';

/** Akteur, der im Nachweis (zaehler.gesetzt_durch) landet. */
export const CLI_AKTEUR = 'CLI npm run zaehler';

export const AUFRUF = 'Aufruf: npm run zaehler [-- --rechnung-max=<n>]';

/** Der Statusblock, den sowohl der reine Abruf als auch das Setzen ausgibt. */
export function formatStand(s: ZaehlerStand): string {
  const grenze = rechnungNrUntergrenze();
  return [
    `Rechnungszaehler (zaehler.rechnung_lfd_nr)`,
    `  Stand:          ${s.wert}`,
    `  Untergrenze:    ${grenze}  (ueberschreibbar per ${UNTERGRENZE_ENV})`,
    `  Festschreibung: ${zaehlerGesperrt(s.wert)
      ? 'GESPERRT — der Zaehler steht nicht ueber der Untergrenze, also noch nicht auf dem FileMaker-Stand'
      : 'moeglich'}`,
    `  Gesetzt am:     ${s.gesetztAm ?? '—'}`,
    `  Gesetzt durch:  ${s.gesetztDurch ?? '—'}`,
  ].join('\n');
}

/**
 * Der Untergrenzen-Hinweis zum Schluss. Bewusst auch nach einem erfolgreichen
 * Setzen: 31491 ist der aus dem Export belegbare Boden, nicht der reale
 * Hoechststand — der steht nur in FileMaker.
 */
export function untergrenzenHinweis(wert: number): string {
  return zaehlerGesperrt(wert)
    ? `Solange der Stand nicht ueber ${rechnungNrUntergrenze()} liegt, weist die Festschreibung jede Rechnung ab. ` +
      `Hoechststand in FileMaker ablesen und setzen: npm run zaehler -- --rechnung-max=<n>`
    : `Hinweis: die Untergrenze ${rechnungNrUntergrenze()} ist nur der aus dem Faktura-Export belegbare Boden ` +
      `(Stand 26.06.2025). Der reale Hoechststand liegt darueber und ist in FileMaker abzulesen.`;
}

/** Reiner Statusabruf ohne Argument. */
export async function zeigeStand(pool: pg.Pool): Promise<string> {
  const s = await rechnungZaehlerStand(pool);
  return [formatStand(s), '', untergrenzenHinweis(s.wert)].join('\n');
}

/** Setzt den Zaehler und zeigt vorher/nachher. Nur aufwaerts (setzeRechnungZaehler). */
export async function setzeStand(pool: pg.Pool, wert: number, akteur: string): Promise<string> {
  const vorher = await rechnungZaehlerStand(pool);
  const zeilen = [`Stand vorher:`, formatStand(vorher), ''];
  await setzeRechnungZaehler(pool, wert, akteur);
  const nachher = await rechnungZaehlerStand(pool);
  zeilen.push(`Stand nachher:`, formatStand(nachher), '', untergrenzenHinweis(nachher.wert));
  return zeilen.join('\n');
}

// CLI: npm run zaehler [-- --rechnung-max=<n>]
// Ohne Argument eine reine Statusabfrage (Exit 0). Kein CSV, kein Import — der
// Zaehler ist keine Migrationsangelegenheit mehr.
// pathToFileURL statt manueller string-Bau: unter Windows braucht ein Laufwerkspfad
// "file:///C:/..." (drei Slashes); ein Template-Literal liefert nur zwei und die
// Bedingung ist nie wahr (das hat hier schon zweimal still gar nichts getan).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const unbekannt = process.argv.slice(2).filter((a) => a.startsWith('--') && !a.startsWith('--rechnung-max='));
  if (unbekannt.length > 0) {
    console.error(`Unbekannte Option(en): ${unbekannt.join(', ')}\n${AUFRUF}`);
    process.exit(2);
  }

  const roh = arg('rechnung-max');
  const geprueft = parseRechnungMax(roh);
  if (geprueft.fehler) {
    console.error(`${geprueft.fehler}\n${AUFRUF}`);
    process.exit(2);
  }

  const { getPool, closePool } = await import('../db/pool');
  const pool = getPool();
  try {
    if (geprueft.wert === undefined) {
      console.log(await zeigeStand(pool));
    } else {
      console.log(await setzeStand(pool, geprueft.wert, CLI_AKTEUR));
    }
  } catch (e) {
    // Abwaerts-Setzen und fehlender Zaehler kommen als Domaenenfehler zurueck:
    // eine Zeile Klartext statt eines Stacktraces.
    const { ValidationError, NotFoundError } = await import('../domain/errors');
    if (e instanceof ValidationError || e instanceof NotFoundError) {
      console.error(e.message);
      await closePool();
      process.exit(1);
    }
    await closePool();
    throw e;
  }
  await closePool();
  process.exit(0);
}
