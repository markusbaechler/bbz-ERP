import { pathToFileURL } from 'node:url';

/**
 * true, wenn das Modul direkt gestartet wurde (`tsx datei.ts`) und nicht importiert ist.
 * Vergleich als Datei-URL: Windows liefert `file:///C:/…`, Leerzeichen sind als %20 kodiert.
 */
export function istEinstieg(metaUrl: string, skript: string | undefined = process.argv[1], windows?: boolean): boolean {
  return !!skript && metaUrl === pathToFileURL(skript, { windows }).href;
}
