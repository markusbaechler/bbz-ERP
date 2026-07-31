// Untergrenze des Rechnungszaehlers (zaehler.rechnung_lfd_nr).
//
// Woher 31491 kommt: das ist die hoechste Rechnungsnummer, die sich aus dem
// vorliegenden FileMaker-Faktura-Export *belegen* laesst — der Export endet am
// 26.06.2025 bei Nr. 31491. Der reale Hoechststand liegt darueber: ein Livebeleg
// vom Juli 2026 traegt bereits Nr. 33214, und auch der ist nur eine Momentaufnahme.
//
// 31491 ist darum ein Boden, keine Antwort. Der Wert sagt nur: "unterhalb davon
// steht der Zaehler sicher noch nicht auf dem FileMaker-Stand". Den wirklichen
// Hoechststand muss der Operator in FileMaker ablesen und mit
// `npm run zaehler -- --rechnung-max=<n>` bzw. `PUT /zaehler/rechnung` setzen.
//
// Warum eine Untergrenze und nicht bloss `> 0`: sie faengt beide Fehler ab —
// "nie gesetzt" (Zaehler steht auf 0) und "versehentlich zu tief gesetzt".
//
// Bewusst eigenes Modul und keine Erweiterung von creditor.ts: dort stehen die
// QR-Creditor-Stammdaten (IBAN, Adresse) fuer den Zahlteil; sie werden vom
// QR-/PDF-Layer gelesen. Die Untergrenze ist eine betriebliche Sicherung der
// Fakturierung und wird von Repo, CLI und Route gelesen. Zwei Themen, zwei Dateien.
const VORGABE_UNTERGRENZE = 31491;

/** Name der Umgebungsvariablen, mit der die Untergrenze ueberschrieben wird. */
export const UNTERGRENZE_ENV = 'RECHNUNG_NR_UNTERGRENZE';

/**
 * Aktuelle Untergrenze. Wird bei jedem Aufruf aus der Umgebung gelesen, damit ein
 * Betrieb sie ohne Rebuild setzen kann. Ein unbrauchbarer Wert wird ignoriert
 * (Fallback auf die Vorgabe) — ein Tippfehler in der Umgebung darf die Sperre
 * nicht versehentlich aufheben.
 */
export function rechnungNrUntergrenze(): number {
  const roh = process.env[UNTERGRENZE_ENV];
  if (roh === undefined) return VORGABE_UNTERGRENZE;
  const t = roh.trim();
  const n = Number(t);
  if (!/^\d+$/.test(t) || !Number.isSafeInteger(n)) return VORGABE_UNTERGRENZE;
  return n;
}

/**
 * Gilt der Zaehler als "noch nicht auf den FileMaker-Stand gesetzt"?
 * Auf der Untergrenze selbst noch gesperrt: 31491 ist bereits vergeben.
 */
export function zaehlerGesperrt(wert: number): boolean {
  return wert <= rechnungNrUntergrenze();
}

/** Einheitlicher Text der Sperre — Festschreibung, CLI und Route sprechen gleich. */
export function zaehlerSperrText(wert: number): string {
  return (
    `Der Rechnungszaehler steht auf ${wert} und damit nicht ueber der Untergrenze ${rechnungNrUntergrenze()}. ` +
    `Er ist noch nicht auf den FileMaker-Stand gesetzt; die erste Nummer wuerde eine bereits vergebene ` +
    `Rechnungsnummer wiederholen (Spec §6.1: einmal vergeben, unwiderruflich). ` +
    `Hoechststand in FileMaker ablesen und setzen: "npm run zaehler -- --rechnung-max=<n>" ` +
    `oder PUT /zaehler/rechnung mit { "wert": <n> } (Admin). ` +
    `Die Untergrenze ${rechnungNrUntergrenze()} ist nur der aus dem Export belegbare Boden ` +
    `(Stand 26.06.2025), der echte Hoechststand liegt darueber — ein Beleg vom Juli 2026 traegt 33214.`
  );
}
