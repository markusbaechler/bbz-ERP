# QR-Rechnung & PDF — Implementation Plan (Plan 3 von 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus einer festgeschriebenen Rechnung eine SIX-konforme Swiss-QR-Rechnung erzeugen — QRR-Referenz (Mod10), QR-Zahlteil/Empfangsschein via `swissqrbill`, PDF (Rechnungsbrief + QR-Seite) — mit Golden-Test gegen den echten Beleg.

**Architecture:** Reine, getestete Domänenfunktionen für QRR-Referenz und QR-Datenaufbau (DB-frei). PDF-Erzeugung mit PDFKit + `swissqrbill`. Creditor-Stammdaten (QR-IBAN etc.) in einer Config. REST liefert das PDF.

**Tech Stack:** wie Plan 1/2 + `swissqrbill` 4.4, `pdfkit`.

## Global Constraints

- **QR-IBAN** Creditor `CH44 3077 7003 7132 1103 0` (SZKB, IID 30777) → **QRR-Referenz zwingend**. (Spec §5.4)
- **QRR** 27-stellig = Kunden-Präfix + nullgepolsterte `lfd_nr` + Mod10-Prüfziffer (`swissqrbill.calculateQRReferenceChecksum`). Präfix `7610400` **aus einem Beleg abgeleitet → gegen SZKB-ISR-Vertrag verifizieren**. (Spec §5.4, §10)
- **Debitor-Adresse vollständig** (Pflicht bereits in Plan 1). (Spec §5.4)
- Beträge zweistellig; `amount = totalBrutto`. Nur festgeschriebene Rechnungen erhalten QR/PDF.
- Reine Logik in `src/domain/*`, PDF in `src/pdf/*`; DB nur über Repos.

---

## Dateistruktur

```
src/config/creditor.ts          # bbz Creditor + QRR-Präfix
src/domain/qrReferenz.ts        # QRR-Referenz (Build + Format)
src/domain/qrRechnung.ts        # baut swissqrbill-Data aus Rechnung/Auftraggeber
src/pdf/rechnungPdf.ts          # PDFKit-Brief + SwissQRBill-Zahlteil -> Buffer
src/server/routes/rechnung.ts   # +GET /rechnung/:id/pdf   (Modify)
test/qrReferenz.test.ts
test/qrRechnung.test.ts
test/rechnungPdf.test.ts
```

---

## Task 1: QRR-Referenz (Golden gegen echten Beleg)

**Files:**
- Create: `src/config/creditor.ts`, `src/domain/qrReferenz.ts`, `test/qrReferenz.test.ts`

**Interfaces:**
- Consumes: `swissqrbill/utils` (`calculateQRReferenceChecksum`, `formatQRReference`)
- Produces:
  - `CREDITOR` (in creditor.ts): `{ account: string; name: string; address: string; buildingNumber: string; zip: number; city: string; country: string; qrrPrefix: string }`
  - `qrReferenzRoh(lfdNr: number, prefix?: string): string` — 27-stellige QRR ohne Leerzeichen (Default-Prefix `CREDITOR.qrrPrefix`)
  - `qrReferenzFormatiert(lfdNr: number, prefix?: string): string` — via `formatQRReference`

- [ ] **Step 1: Failing test** — `test/qrReferenz.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { qrReferenzRoh, qrReferenzFormatiert } from '../src/domain/qrReferenz';

describe('QRR-Referenz (Golden gegen echten Beleg 33214)', () => {
  it('reproduziert die echte Referenz', () => {
    expect(qrReferenzRoh(33214)).toBe('761040000000000000000332141');
    expect(qrReferenzFormatiert(33214)).toBe('76 10400 00000 00000 00003 32141');
  });
  it('ist 27-stellig', () => {
    expect(qrReferenzRoh(1)).toHaveLength(27);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- qrReferenz` → FAIL.

- [ ] **Step 3: Implementieren**

`src/config/creditor.ts`:
```ts
// bbz Creditor-Stammdaten (aus echtem Beleg). QR-IBAN SZKB, IID 30777.
export const CREDITOR = {
  account: 'CH4430777003713211030',
  name: 'Bankenberatungszentrum bbz st.gallen ag',
  address: 'Zürcherstrasse',
  buildingNumber: '202',
  zip: 9014,
  city: 'St. Gallen',
  country: 'CH',
  qrrPrefix: '7610400', // TODO gegen SZKB-ISR-Vertrag verifizieren
} as const;
```

`src/domain/qrReferenz.ts`:
```ts
import { calculateQRReferenceChecksum, formatQRReference } from 'swissqrbill/utils';
import { CREDITOR } from '../config/creditor';

export function qrReferenzRoh(lfdNr: number, prefix: string = CREDITOR.qrrPrefix): string {
  const body = (prefix + String(lfdNr).padStart(26 - prefix.length, '0')); // 26-stellig
  return body + calculateQRReferenceChecksum(body); // + Mod10-Pruefziffer -> 27
}

export function qrReferenzFormatiert(lfdNr: number, prefix: string = CREDITOR.qrrPrefix): string {
  return formatQRReference(qrReferenzRoh(lfdNr, prefix));
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- qrReferenz` → PASS.
  *(Falls die Golden-Assertion scheitert: der `qrrPrefix` stimmt nicht mit dem SZKB-ISR-Vertrag überein — Prefix korrigieren, NICHT den Test aufweichen.)*

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(qr): QRR-Referenz (Mod10) + Creditor-Config, Golden gegen Beleg"
```

---

## Task 2: QR-Daten aus Rechnung aufbauen

**Files:**
- Create: `src/domain/qrRechnung.ts`, `test/qrRechnung.test.ts`

**Interfaces:**
- Consumes: `Rechnung`, `Auftraggeber` (types), `CREDITOR`, `qrReferenzRoh`, `swissqrbill/types` (`Data`)
- Produces:
  - `baueQrDaten(rechnung: Rechnung, auftraggeber: Auftraggeber): Data` — wirft `ValidationError` wenn `rechnung.lfdNr` null (nicht festgeschrieben)

- [ ] **Step 1: Failing test** — `test/qrRechnung.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { baueQrDaten } from '../src/domain/qrRechnung';
import { ValidationError } from '../src/domain/errors';
import type { Rechnung, Auftraggeber } from '../src/domain/types';

const auftraggeber: Auftraggeber = {
  id: 'a1', nummer: '20577', name: 'bbz academy', strasse: 'Zürcherstrasse 202',
  plz: '9014', ort: 'St. Gallen', land: 'CH', ansprechperson: null, email: null, telefon: null, aktiv: true,
};
const rechnung: Rechnung = {
  id: 'r1', projektId: 'p1', auftraggeberId: 'a1', datum: '2026-07-23', betreff: 'Test',
  mwstModus: 'exkl', waehrung: 'CHF', lfdNr: 33214, nummer: '6231.26 - 33214 ml',
  status: 'abgerechnet', totalNetto: 7705, totalMwst: 624.10, totalBrutto: 8329.10,
};

describe('baueQrDaten', () => {
  it('setzt Creditor QR-IBAN, Referenz, Betrag und Debitor', () => {
    const d = baueQrDaten(rechnung, auftraggeber);
    expect(d.creditor.account).toBe('CH4430777003713211030');
    expect(d.amount).toBe(8329.10);
    expect(d.currency).toBe('CHF');
    expect(d.reference).toBe('761040000000000000000332141');
    expect(d.debtor?.name).toBe('bbz academy');
    expect(d.debtor?.city).toBe('St. Gallen');
  });
  it('verweigert nicht festgeschriebene Rechnung', () => {
    expect(() => baueQrDaten({ ...rechnung, lfdNr: null }, auftraggeber)).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- qrRechnung` → FAIL.

- [ ] **Step 3: Implementieren** — `src/domain/qrRechnung.ts`

```ts
import type { Data } from 'swissqrbill/types';
import type { Rechnung, Auftraggeber } from './types';
import { CREDITOR } from '../config/creditor';
import { qrReferenzRoh } from './qrReferenz';
import { ValidationError } from './errors';

export function baueQrDaten(rechnung: Rechnung, auftraggeber: Auftraggeber): Data {
  if (rechnung.lfdNr === null) throw new ValidationError('QR nur fuer festgeschriebene Rechnung (lfdNr fehlt)');
  return {
    currency: 'CHF',
    amount: rechnung.totalBrutto,
    reference: qrReferenzRoh(rechnung.lfdNr),
    creditor: {
      account: CREDITOR.account, name: CREDITOR.name, address: CREDITOR.address,
      buildingNumber: CREDITOR.buildingNumber, zip: CREDITOR.zip, city: CREDITOR.city, country: CREDITOR.country,
    },
    debtor: {
      name: auftraggeber.name, address: auftraggeber.strasse, zip: auftraggeber.plz,
      city: auftraggeber.ort, country: auftraggeber.land,
    },
  };
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- qrRechnung` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(qr): swissqrbill-Daten aus Rechnung/Auftraggeber"
```

---

## Task 3: PDF-Erzeugung (Brief + QR-Zahlteil)

**Files:**
- Create: `src/pdf/rechnungPdf.ts`, `test/rechnungPdf.test.ts`
- Modify: `package.json` (Dep `pdfkit` + `@types/pdfkit`)

**Interfaces:**
- Consumes: `pdfkit`, `swissqrbill/pdf` (`SwissQRBill`), `baueQrDaten`, `berechneMwst`, `Rechnung`, `Rechnungsposition`, `Auftraggeber`, `CREDITOR`
- Produces:
  - `erzeugeRechnungPdf(rechnung: Rechnung, positionen: Rechnungsposition[], auftraggeber: Auftraggeber): Promise<Buffer>` — A4-PDF: Kopf (Creditor), Meta (Nr/Datum/Betreff), Positionstabelle, MWSt-Zusammenfassung, Total; danach QR-Zahlteil/Empfangsschein

- [ ] **Step 1: Dep installieren**

Run: `npm install pdfkit @types/pdfkit`
Expected: Pakete in `package.json`.

- [ ] **Step 2: Failing test** — `test/rechnungPdf.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { erzeugeRechnungPdf } from '../src/pdf/rechnungPdf';
import type { Rechnung, Rechnungsposition, Auftraggeber } from '../src/domain/types';

const auftraggeber: Auftraggeber = {
  id: 'a1', nummer: '20577', name: 'bbz academy', strasse: 'Zürcherstrasse 202',
  plz: '9014', ort: 'St. Gallen', land: 'CH', ansprechperson: null, email: null, telefon: null, aktiv: true,
};
const rechnung: Rechnung = {
  id: 'r1', projektId: 'p1', auftraggeberId: 'a1', datum: '2026-07-23', betreff: 'Verrechnung',
  mwstModus: 'exkl', waehrung: 'CHF', lfdNr: 33214, nummer: '6231.26 - 33214 ml',
  status: 'abgerechnet', totalNetto: 7705, totalMwst: 624.10, totalBrutto: 8329.10,
};
const positionen: Rechnungsposition[] = [
  { id: 'x', rechnungId: 'r1', position: 1, beschreibung: '33.5 Std. à 230.00', menge: 33.5, einheit: 'Std', einzelpreis: 230, mwstSatz: 8.1, kontoId: null, betragNetto: 7705 },
];

describe('erzeugeRechnungPdf', () => {
  it('erzeugt ein nicht-leeres PDF', async () => {
    const buf = await erzeugeRechnungPdf(rechnung, positionen, auftraggeber);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
```

- [ ] **Step 3: Verify fail** — Run: `npm test -- rechnungPdf` → FAIL.

- [ ] **Step 4: Implementieren** — `src/pdf/rechnungPdf.ts`

```ts
import PDFDocument from 'pdfkit';
import { SwissQRBill } from 'swissqrbill/pdf';
import type { Rechnung, Rechnungsposition, Auftraggeber } from '../domain/types';
import { CREDITOR } from '../config/creditor';
import { baueQrDaten } from '../domain/qrRechnung';
import { berechneMwst } from '../domain/mwst';

export function erzeugeRechnungPdf(rechnung: Rechnung, positionen: Rechnungsposition[], auftraggeber: Auftraggeber): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const fertig = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Kopf
  doc.fontSize(9).text(`${CREDITOR.name}`, { align: 'right' });
  doc.text(`${CREDITOR.address} ${CREDITOR.buildingNumber}, ${CREDITOR.zip} ${CREDITOR.city}`, { align: 'right' });
  doc.moveDown();
  // Empfaenger
  doc.fontSize(11).text(auftraggeber.name);
  doc.text(`${auftraggeber.strasse}`);
  doc.text(`${auftraggeber.plz} ${auftraggeber.ort}`);
  doc.moveDown();
  // Meta
  doc.fontSize(10).text(`Rechnungs-Nr.: ${rechnung.nummer ?? ''}`);
  doc.text(`Datum: ${rechnung.datum}`);
  if (rechnung.betreff) doc.font('Helvetica-Bold').text(rechnung.betreff).font('Helvetica');
  doc.moveDown();
  // Positionen
  for (const p of positionen) {
    doc.text(`${p.beschreibung}   ${p.menge} ${p.einheit} à ${p.einzelpreis.toFixed(2)}   ${p.mwstSatz}%   ${p.betragNetto.toFixed(2)}`);
  }
  doc.moveDown();
  // MWSt-Zusammenfassung
  const e = berechneMwst(positionen.map((p) => ({ betrag: p.betragNetto, satz: p.mwstSatz })), rechnung.mwstModus);
  for (const z of e.proSatz) doc.text(`Netto ${z.netto.toFixed(2)} à ${z.satz}% = MWSt ${z.steuer.toFixed(2)}`);
  doc.font('Helvetica-Bold').text(`Rechnungsbetrag: CHF ${e.totalBrutto.toFixed(2)}`).font('Helvetica');

  // QR-Zahlteil (eigene Seite/Slip unten)
  const qr = new SwissQRBill(baueQrDaten(rechnung, auftraggeber));
  qr.attachTo(doc);

  doc.end();
  return fertig;
}
```

- [ ] **Step 5: Verify pass** — Run: `npm test -- rechnungPdf` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(pdf): Rechnungs-PDF (Brief + Swiss-QR-Zahlteil)"
```

---

## Task 4: REST-Route PDF

**Files:**
- Modify: `src/server/routes/rechnung.ts`
- Create: `test/rechnungPdfRoute.test.ts`

**Interfaces:**
- Consumes: `erzeugeRechnungPdf`, `getRechnung`, `listPositionen`, `getAuftraggeberById`
- Produces:
  - `GET /rechnung/:id/pdf` → `200`, `content-type: application/pdf`, PDF-Body. `400` wenn nicht festgeschrieben, `404` wenn unbekannt.

- [ ] **Step 1: Failing test** — `test/rechnungPdfRoute.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
let rechnungId: string;
beforeAll(async () => {
  await resetDb(getPool());
  const auftraggeberId = (await createAuftraggeber(getPool(), { name: 'bbz academy', strasse: 'Zürcherstrasse 202', plz: '9014', ort: 'St. Gallen' })).id;
  const projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' });
  await addPosition(getPool(), r.id, { beschreibung: '33.5 Std', menge: 33.5, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' });
  await festschreiben(getPool(), r.id, 'ml');
  rechnungId = r.id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('GET /rechnung/:id/pdf', () => {
  it('liefert ein PDF', async () => {
    const res = await app.inject({ method: 'GET', url: `/rechnung/${rechnungId}/pdf`, headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- rechnungPdfRoute` → FAIL.

- [ ] **Step 3: Implementieren** — in `src/server/routes/rechnung.ts` ergänzen

Import oben:
```ts
import { getAuftraggeberById } from '../../repos/auftraggeberRepo';
import { erzeugeRechnungPdf } from '../../pdf/rechnungPdf';
```
Route (innerhalb `registerRechnungRoutes`, vor Schluss):
```ts
  app.get('/rechnung/:id/pdf', async (req, reply) => {
    try {
      const id = (req.params as any).id;
      const rechnung = await getRechnung(pool, id);
      const positionen = await listPositionen(pool, id);
      const auftraggeber = await getAuftraggeberById(pool, rechnung.auftraggeberId);
      const pdf = await erzeugeRechnungPdf(rechnung, positionen, auftraggeber);
      return reply.header('content-type', 'application/pdf').send(pdf);
    } catch (e) { return mapErr(reply, e); }
  });
```

- [ ] **Step 4: Verify pass** — Run: `npm test` (alle) → PASS; danach `npx tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): GET /rechnung/:id/pdf (Swiss-QR-Rechnung als PDF)"
```

---

## Self-Review (gegen Spec)

- **Spec-Abdeckung:** §5.4 QR-Rechnung (QR-IBAN, QRR-Referenz Mod10, Creditor/Debitor, Betrag) ✓, PDF Brief+Zahlteil ✓, §9 Golden-Test gegen echten Beleg (Referenz `76 10400 …332141`, Betrag 8'329.10) ✓. Swico/S1-String (§5.3) bewusst als Folge-Verfeinerung offen (siehe unten).
- **Platzhalter:** keine (Creditor-Werte real; `qrrPrefix` als verifizierungsbedürftig markiert, nicht leer).
- **Typ-Konsistenz:** `baueQrDaten` liefert `swissqrbill/types`.`Data`; `erzeugeRechnungPdf(rechnung, positionen, auftraggeber)` einheitlich in Task 3+4; nutzt `berechneMwst` aus Plan 2.

## Offene Punkte
- **`qrrPrefix` (`7610400`)** gegen SZKB-ISR-Vertrag verifizieren — Golden-Test schlägt sonst fehl (gewünscht).
- **Swico-S1-String** (`additionalInformation`) mit MWST-Nr/Satz für maschinenlesbare MWSt im QR-Teil → eigener kleiner Folge-Task.
- **PDF-Layout** ist funktional, nicht pixelgleich zum FileMaker-Beleg; Feinlayout iterativ.
