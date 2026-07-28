// Rollen-Header: einziger Ort, an dem die Identitaet gesetzt wird.
// Platzhalter bis Entra-ID/MSAL verdrahtet ist — dann wird hier das Token gesetzt.
const KOPFZEILEN = { 'content-type': 'application/json', 'x-user-role': 'admin' };

export class ApiFehler extends Error {
  constructor(status, meldung) { super(meldung); this.status = status; this.meldung = meldung; }
}

async function auswerten(antwort) {
  if (antwort.ok) return antwort.status === 204 ? null : antwort.json();
  let meldung = `Unerwarteter Fehler (${antwort.status})`;
  try { const k = await antwort.json(); if (k && k.error) meldung = k.error; } catch { /* kein JSON */ }
  throw new ApiFehler(antwort.status, meldung);
}

export async function hole(pfad) {
  return auswerten(await fetch(pfad, { headers: KOPFZEILEN }));
}

export async function sende(methode, pfad, koerper) {
  return auswerten(await fetch(pfad, {
    method: methode, headers: KOPFZEILEN,
    body: koerper === undefined ? undefined : JSON.stringify(koerper),
  }));
}
