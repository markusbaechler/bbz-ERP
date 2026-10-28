# Homepage-Anbindung (WordPress/Elementor/WPForms)

Ausgangslage [belegt: docs/analyse/WEBSITE-GESCHAEFTSPROZESSE.md]: Die Website läuft auf WordPress mit Elementor und WPForms (Hosting bei Hostpoint). Die Formulare laufen heute über **Zapier → SharePoint/M365**. Öffentliche Kurse werden in Moodle gebucht; die Termine zeigt das Plugin `moodle-f2f-display`. Prüfungstermine werden doppelt gepflegt.

## 1. API-Schlüssel anlegen (Admin, einmalig)
```http
POST /admin/api-clients
{ "name": "Homepage", "scopes": ["public:read","public:anmeldung"], "erlaubteOrigins": ["https://www.bankenberatungszentrum.ch"] }
POST /admin/api-clients
{ "name": "Zapier", "scopes": ["public:formular","public:anfrage"] }
```
Der Schlüssel erscheint **nur in der Antwort**; gespeichert wird nur der SHA-256-Hash. Wird ein Schlüssel kompromittiert: `POST /admin/api-clients/:id/rotieren`.
- **Homepage-Schlüssel** = „publishable key“: Er steht im Seitenquelltext, kann nur lesen und anmelden und ist an die Origin gebunden.
- **Zapier-Schlüssel** = geheim: Er wird nur im Zap hinterlegt, nie im Browser.

## 2. Kurskatalog + Anmeldung als Widget (ersetzt doppelte Terminpflege)
Elementor → Widget „HTML“:
```html
<div data-bbz-kurse data-bereich="Banking" data-anmeldung="ja"></div>
<script src="https://erp.bankenberatungszentrum.ch/widget/bbz-kurse.js"
        data-api="https://erp.bankenberatungszentrum.ch" data-key="bbz_xxxxxxxx_…" defer></script>
```
- `data-bereich` filtert nach Kursbereich, `data-kurs="<slug>"` zeigt nur einen Kurs, `data-anmeldung="ja"` blendet das Formular ein.
- Farben: `style="--bbz-akzent:#00508c"` am Container.
- Doppelklick und erneutes Senden erzeugen keine Doppelanmeldung (`idempotency-key` je Formular).
- Ist ein Kurs voll, landet die Person automatisch auf der Warteliste.

## 3. Formulare über Zapier ins ERP (statt SharePoint)
Im bestehenden Zap die Aktion *SharePoint* ersetzen durch **Webhooks by Zapier → POST**:
- URL: `https://erp…/public/v1/formulare/<formular>`
- Payload Type `json`, Header `x-api-key: <Zapier-Schlüssel>` und `idempotency-key: {{WPForms Entry ID}}`
- Data: die WPForms-Felder **mit ihren Beschriftungen** als Schlüssel. Das Mapping erkennt die Website-Labels, z. B. „Vor- und Nachname“, „Geschäftliche E-Mail“, „Anmeldung für“, „Profil“, „Teilprüfungen“, „Einverständnis Rechnung an Bank“.

| `<formular>` | Website-Formular | Ergebnis im ERP |
|---|---|---|
| `kontakt` | Kontakt | CRM-Anfrage (typ kontakt) |
| `anfrage-uek-bem` | Anfrage ÜK/BEM | CRM-Anfrage (offerte, Nachwuchs) |
| `clientis` | Clientis-Anmeldung | CRM-Anfrage (tailormade) |
| `saq-anmeldung` | SAQ-Zertifizierung (5 Schritte) | **SAQ-Vorgang**, dazu Anfrage als Herkunftsnachweis; Bank über Namen/Alias zugeordnet, Debitor gesetzt |
| `dlp`, `bfk-uno`, `fuehrungseinstieg`, `anmeldung` | Lehrgangs-Anmeldungen | **Anmeldung**, wenn ein ERP-Durchführungscode mitkommt (z. B. Feld „Durchführung“ = `DLP-2027-1`), sonst Offertanfrage |

Antworten: `201` mit `{status, referenz}`, `422` mit `fehler[]` (Pflichtfeld fehlt, z. B. Datenschutz/AGB/Bank/Profil), `404` bei unbekanntem Formular. Wiederholte Zustellungen mit derselben Entry-ID liefern die erste Antwort (`idempotent-replayed: true`).

Alternative ohne Zapier: WPForms-Addon *Webhooks* mit derselben URL, denselben Headern und derselben Feldzuordnung.

## 4. Webhooks an die Homepage (optional)
`POST /admin/webhooks {name, url, ereignisse}` (nur `https://`). Die Antwort enthält das **Secret** (nur einmal sichtbar).
Ereignisse: `kurs.aktualisiert`, `anmeldung.eingegangen|bestaetigt|storniert|warteliste|nachgerueckt`, `saq.angemeldet`, `*`.
Beispiel: WordPress leert bei `kurs.aktualisiert` den Seiten-Cache (WP Super Cache).

Prüfung beim Empfänger (PHP, z. B. als REST-Route eines Mini-Plugins):
```php
$body = file_get_contents('php://input');
$ts   = $_SERVER['HTTP_X_BBZ_TIMESTAMP'] ?? '';
$soll = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, BBZ_WEBHOOK_SECRET);
if (!hash_equals($soll, $_SERVER['HTTP_X_BBZ_SIGNATURE'] ?? '') || abs(time() - (int)$ts) > 300) { http_response_code(401); exit; }
$ereignis = json_decode($body, true); // {id, ereignis, zeitpunkt, daten}
```
Nicht-2xx-Antworten werden mit Backoff wiederholt (1, 2, 4 … Minuten, maximal 8 Versuche); den Stand zeigt `/admin/outbox`.

## 5. Schutzmassnahmen (Security-Review 28.10.2026)
- **Rate-Limit** je Schlüssel und zusätzlich **je Absender-IP**: Standard 10 Anmeldungen/Anfragen und 120 Katalogabrufe pro Minute und IP. Hinter Azure oder einem Proxy muss `TRUST_PROXY` gesetzt sein.
- Für stärker exponierte Formulare empfiehlt sich zusätzlich ein Captcha, z. B. Cloudflare Turnstile im Widget oder in WPForms [offen].
- **Neutrale Antworten:** Eine Doppelanmeldung oder eine unbekannte bzw. nicht öffentliche Durchführung beantwortet die API mit `202 {status:"eingegangen"}`. So lässt sich nicht abfragen, wer angemeldet ist.
- **Bestehende Kontakte** werden über die Homepage nie geändert. Abweichende Angaben landen als Bemerkung zur Prüfung.
- **Steuerzeichen** in Eingaben werden abgelehnt (400). Interne Fehler antworten nur mit „Interner Fehler“.
- **Webhooks:** nur `https`, keine internen Ziele (private IP-Bereiche, auch nach DNS-Auflösung), keine Weiterleitungen.

## 6. Datenschutz (nDSG)
- Die Public-API gibt **keine Personendaten** heraus, Antworten enthalten nur Status und Referenz.
- Der Newsletter verlangt die Einwilligung, die mit Zeitpunkt und Quelle gespeichert wird.
- Organisationen und Rechnungsempfänger werden **serverseitig** zugeordnet. IDs von aussen werden ignoriert.
