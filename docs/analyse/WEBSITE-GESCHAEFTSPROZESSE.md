# bbz st.gallen ag: Inventar der Geschäftsprozesse (Website-Recherche)

Stand: 28.10.2026 · Kennzeichnung: [belegt: URL] = direkt auf der Quelle gelesen · [Hypothese] = eigene Ableitung

## 0. Methodik und Erreichbarkeit

- WebFetch konnte den Host nicht auflösen (DNS-Fehler im Sandbox-Netz). Deshalb wurde die Website per curl über den Session-Proxy vollständig abgerufen. Das ist bewusst ein Workaround, die Daten stammen aber direkt von der Live-Site. [belegt: https://www.bankenberatungszentrum.ch/]
- https://bankenberatungszentrum.ch leitet per 301 auf www weiter. http://bankenberatungszentrum.ch war nicht auflösbar. Die Mail-Domain bankenberatung.ch war aus der Session nicht erreichbar (Verbindung zurückgesetzt). [belegt: https://bankenberatungszentrum.ch]
- Die WordPress-REST-API ist öffentlich. Inventar: 28 Seiten, 52 Kurse (Custom Post Type «kurs»), 31 Team-Einträge («bbz_team») und 0 Blogbeiträge. Es gibt also keine News-, Agenda- oder Kurskalender-Seite. Die Termine stehen pro Kurs. [belegt: https://www.bankenberatungszentrum.ch/wp-json/wp/v2/pages] [belegt: https://www.bankenberatungszentrum.ch/wp-json/wp/v2/kurs] [belegt: https://www.bankenberatungszentrum.ch/wp-json/wp/v2/posts]
- Die Inhalte (AGB und Datenschutz «Version 1.0.0, Oktober 2026», Uploads 2026/09) deuten auf einen Relaunch im Herbst 2026 hin. [Hypothese]

## 1. Angebotsportfolio

### 1.1 Struktur
- Hauptnavigation: Nachwuchsbildung · Zertifizieren · Weiterbildung (Banking, Leadership, Foren) · Beratung & Projekte (Bildungskonzeptionen, Zertifizierungsprogramme) · bbz (Über uns, Team, Karriere) · Kontakt · Login «mybbz». [belegt: https://www.bankenberatungszentrum.ch/kurs/anlagefonds-lizenz/]
- Kurs-Taxonomien: Kursbereich (Banking 32, Rezertifizierung 21, Leadership 13, Diploma 7, Nachwuchsbildung 5), Kurstyp (Präsenzkurs 41, Webinar 4), Berufsprofil (PK, IK, Affluent, CWMA, KMU, CCoB, «kein Profil»), 8 Kompetenzfelder. [belegt: https://www.bankenberatungszentrum.ch/wp-json/wp/v2/kursbereich] [belegt: https://www.bankenberatungszentrum.ch/wp-json/wp/v2/kompetenzfeld]
- Eigenangaben: 25+ Jahre, 300+ Zertifizierungen pro Jahr, 50+ Banken, >80 % Erfolgsquote. [belegt: https://www.bankenberatungszentrum.ch/] Auf «Über uns» stehen dagegen 3500+ zertifizierte Personen, 60+ Banken und 6 SAQ-Profile; die Bankenzahl weicht also ab. [belegt: https://www.bankenberatungszentrum.ch/ueber-uns/]

### 1.2 Nachwuchsbildung
| Angebot | Eckdaten | Quelle |
|---|---|---|
| Überbetriebliche Kurse (Banklehre, EFZ Kaufmann/-frau Branche Bank) | rund 30 Module über 3 Jahre, kleine Klassen | [belegt: https://www.bankenberatungszentrum.ch/kurs/ueberbetriebliche-kurse/] |
| BEM «Banking & Beratung» | 18 Monate, 18 Kurstage, Start jeweils im August, Abschluss mit SBVg-Zertifikat «BEM» | [belegt: https://www.bankenberatungszentrum.ch/kurs/banking-beratung/] |
| Training für Praxisausbildende | 2 Tage / 20 Lernstunden (LS), CHF 850 inkl. Verpflegung und Unterlagen | [belegt: https://www.bankenberatungszentrum.ch/kurs/training-fuer-praxisausbildende/] |
| Prüfungs-Coach betriebliches QV | 1 Tag / 12 LS, CHF 400 | [belegt: https://www.bankenberatungszentrum.ch/kurs/pruefungs-coach-betriebliches-qv/] |
| Forum Nachwuchsverantwortliche | Austauschformat für die Kundenbanken (z.B. 22.06.2027, Zürich) | [belegt: https://www.bankenberatungszentrum.ch/kurs/forum-nachwuchsverantwortliche/] |

Für ÜK und BEM gibt es weder Preise noch Termine, nur ein Anfrageformular. [belegt: https://www.bankenberatungszentrum.ch/kurs/ueberbetriebliche-kurse/]

### 1.3 SAQ-Zertifizierung «Kundenberater Bank»
- Preise pro Profil (exkl. MWST, Preise je nach Institut variabel): PK CHF 2'025 · IK 2'250 · Affluent 3'025 · CWMA 3'225 · KMU 3'375 · CCoB 3'625. Enthalten sind Lernmaterial, je 1 Versuch schriftlich und mündlich, Lernplattform und Zertifikat. Die Remoteprüfung kostet CHF 300 Aufpreis, dazu kommt allenfalls eine Support-Fee von CHF 45 pro 15 Minuten. [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/]
- Ablauf in 6 Schritten: (1) Anmeldung, danach persönlicher Online-Zugang; Lernmaterial als eBook oder Bundle bestellbar. (2) Lernphase mit Probeprüfungen. (3) Schriftliche Prüfung: Single und Multiple Choice am PC, zentral oder bei der Bank oder remote, bestanden ab >70 %. (4) Lernphase Methodenkompetenz. (5) Mündliche Prüfung: 60-minütiges Beratungsgespräch im 4-Augen-Prinzip, bestanden ab >70 %. (6) SAQ-Zertifikat, danach Beginn der Rezertifizierungsfrist. [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/]
- Prüfungsorte: Deutsch in Zürich und St. Gallen, Französisch in Lausanne, Italienisch über das Centro Studi Villa Negroni, dazu Remote. [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/] In St. Gallen und Lausanne gilt BYOD. Publiziert sind 49 schriftliche Termine (Okt. 2026 bis Dez. 2027; 4 ausgebucht) [belegt: https://www.bankenberatungszentrum.ch/termine-schriftliche-pruefung/] und 34 mündliche Termine (7 ausgebucht; Vezia auf Anfrage). Für die mündliche Prüfung ist die bestandene schriftliche Prüfung Voraussetzung. [belegt: https://www.bankenberatungszentrum.ch/termine-muendliche-pruefung/]
- Die Terminlisten werden als Elementor-Listen mit Status-Icons manuell gepflegt und sind nicht mit einem System verbunden. [belegt: Seitenquelltext https://www.bankenberatungszentrum.ch/termine-schriftliche-pruefung/] Die Daten werden in den Auswahlfeldern des Anmeldeformulars zusätzlich ein zweites Mal geführt. [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/]
- Werden eigene oder elektronische Hilfsmittel eingesetzt, muss jeder Fall geprüft werden, und es fällt eine «Handling Fee» an. [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/]
- Vorbereitungskurse:
  - Schriftlich: 6 LS mit Probeprüfung, 2 h Virtual Classroom in MS Teams und Fokusthemen über MS Forms. Staffelpreis pro Person von CHF 1'250 (1 TN) bis CHF 400 (9 bis 10 TN). [belegt: https://www.bankenberatungszentrum.ch/kurs/vorbereitung-schriftliche-saq-zertifizierung/]
  - Mündlich: 6 LS, ein virtueller und ein Präsenzteil. CHF 2'500, 1'600 oder 1'200, plus Nebenkosten CHF 80 und CHF 10. [belegt: https://www.bankenberatungszentrum.ch/kurs/vorbereitung-muendliche-saq-zertifizierung/]
- Bankfachgrundbildung für Erwachsene (BFK) mit SAQ PK, auch für Quereinsteigende:
  - Umfang: 16 Tage (3 Module zu je 5 Tagen plus Schlussprüfung). [belegt: https://www.bankenberatungszentrum.ch/kurs/bankfachgrundbildung-fuer-erwachsene-mit-saq-zertifizierung/]
  - Preise: CHF 4'900; einzeln CHF 1'620 pro Modul, Schlussprüfung CHF 450, SAQ PK CHF 1'725. Nebenkosten CHF 2'250, Lehrmittel «Banking Today» CHF 450.
  - Abschluss: Diplom bbz. Modulprüfungen sind vorgesehen.
- Rezertifizierung:
  - Gültigkeit 3 Jahre; nachzuweisen sind 24 anerkannte LS innerhalb von 36 Monaten. Anrechenbar sind Seminare, Webinare, E-Learnings und Fachveranstaltungen. [belegt: https://www.bankenberatungszentrum.ch/rezertifizierung/]
  - Jeder Kurs nennt die anrechenbaren Profile und die Komponente «Fachwissen» und/oder «Verhalten». [belegt: https://www.bankenberatungszentrum.ch/kurs/anlagefonds-lizenz/]
  - Daneben gibt es eine «Institutsspezifische Rezertifizierung» als Projektleistung. [belegt: https://www.bankenberatungszentrum.ch/institutsspezifische-rezertifizierung/]
  - «Boxenstopp Kundengespräch»: 24 LS, CHF 2'500 bei 1 TN bzw. CHF 1'950 ab 2 TN. [belegt: https://www.bankenberatungszentrum.ch/kurs/boxenstopp-kundengespraech/]

### 1.4 Weiterbildung Banking (Auswahl)
| Kurs | Dauer / LS | Preis | Quelle |
|---|---|---|---|
| Anlagefonds Lizenz | 1 Tag, 16 LS, Abschlusstest nach 2 Wochen | CHF 650 + eLearning CHF 250 + Nebenkosten-Pauschale CHF 135/Tag (2026) bzw. 150/Tag (2027) | [belegt: https://www.bankenberatungszentrum.ch/kurs/anlagefonds-lizenz/] |
| Vorsorge Lizenz | 2 Tage, 24 LS | CHF 1'500 + Nebenkosten | [belegt: https://www.bankenberatungszentrum.ch/kurs/vorsorge-lizenz/] |
| Eigenheimfinanzierung | 3 Tage, 36 LS, Diplom | CHF 2'900 + Nebenkosten | [belegt: https://www.bankenberatungszentrum.ch/kurs/eigenheimfinanzierung/] |
| Kommerzielle Kreditkunden (BKK) | 3×3 Tage + ½ Tag Fachtest | CHF 5'900 + Nebenkosten | [belegt: https://www.bankenberatungszentrum.ch/kurs/kommerzielle-kreditkunden/] |
| Bankwesen Basiswissen Kompakt (Quereinsteigende ohne Kundenkontakt, z.B. Compliance, IT, Backoffice) | 6 Tage in 3 Modulen | CHF 3'850, Module einzeln buchbar | [belegt: https://www.bankenberatungszentrum.ch/kurs/bankwesen-basiswissen-kompakt/] |
| BFK für UNO-Banken (Gesamt 16 Tage / Kompakt 7 Tage) | teils bei der UKB in Altdorf, teils digital | nicht publiziert | [belegt: https://www.bankenberatungszentrum.ch/kurs/bankfachgrundbildung-uno/] |
| KMU-, Kredit- und Steuerkurse | meist 2 Tage / 16 LS | meist CHF 1'500 | [belegt: https://www.bankenberatungszentrum.ch/banking/] |
| Sustainable Finance Grundlagen (Webinar) | 3 LS | CHF 350 | [belegt: https://www.bankenberatungszentrum.ch/kurs/sustainable-finance-grundlagen/] |
| Derivate «Basic» (Webinar) | 10 LS | CHF 950 | [belegt: https://www.bankenberatungszentrum.ch/kurs/derivate-und-strukturierte-produkte-basic/] |

Bei den Nebenkosten gibt es mehrere Modelle: eine Tagespauschale inkl. Verpflegung, oder CHF 80 pro Tag für Infrastruktur und Referentenspesen plus effektive Verpflegungs- und Übernachtungskosten, dazu Unterlagen CHF 50 und eLearning-Lizenzen CHF 150 bis 250. [belegt: https://www.bankenberatungszentrum.ch/kurs/selbstfuehrung-als-schluessel-zu-wirksamer-fuehrung/]

### 1.5 Leadership
- Diploma Leadership Practitioner in Banking & Finance (DLP):
  - Dauer 12 bis 24 Monate, 12 Präsenztage, Module frei wählbar; Start mit dem «Boxenstopp».
  - Preis CHF 11'300 + Nebenkosten.
  - Abschluss mit drei Transfernachweisen («Transfer Center», CHF 1'000).
  - Voraussetzung: Lebenslauf.
  - [belegt: https://www.bankenberatungszentrum.ch/kurs/diploma-leadership-practitioner-in-banking-finance/] [belegt: https://www.bankenberatungszentrum.ch/kurs/transfer-center/]
- Führungsmodule zu je 2 Tagen / 24 LS für CHF 1'850. Ein Teil davon ist mit «Verhalten» rezertifizierungsfähig. [belegt: https://www.bankenberatungszentrum.ch/leadership/]
- Führungsreise-Boxenstopp mit 360°-Analyse: CHF 1'050. [belegt: https://www.bankenberatungszentrum.ch/kurs/sind-sie-bereit-ihre-fuehrungsreise-zu-starten/]
- «So geht Führungseinstieg heute»: CHF 3'500, rein digital, 3,5 Monate Coaching und 1 Jahr App-Zugang, in Kooperation mit Monoceros-Peers. [belegt: https://www.bankenberatungszentrum.ch/kurs/so-geht-fuehrungseinstieg-heute/]

### 1.6 Foren, Events und Beratung & Projekte
- Hypoforum mit eigener Website, 80+ Teilnehmende pro Jahr in Zürich. Connect KB: Workshop für Kantonal- und Regionalbanken, 2 Tage, CHF 1'850. [belegt: https://www.bankenberatungszentrum.ch/foren/] [belegt: https://www.bankenberatungszentrum.ch/kurs/connect-kb/]
- Bildungs-Outlook: jährlicher Online-Anlass (16.09.2026), Einladung per .ics-Datei, Präsentation als Download. [belegt: https://www.bankenberatungszentrum.ch/bildungsoutlook/]
- Tailor-made («Bildungskonzeptionen») und institutsspezifische Zertifizierungsprogramme laufen nach dem Vorgehen Analyse, Konzeption, Umsetzung und Wirkung. [belegt: https://www.bankenberatungszentrum.ch/bildungskonzeptionen/] [belegt: https://www.bankenberatungszentrum.ch/zertifizierungsprogramme/]
- Gruppenspezifische Kanäle:
  - Seite «Clientis Anmeldung» (nicht in der Navigation) mit den Angeboten Ganzheitliche Beratung, Hybride Beratung mit Touchway, Verhandeln kompakt, Serviceorientierung und den Formaten Online-Lehrgang, Kompakt und Beratungscheck. [belegt: https://www.bankenberatungszentrum.ch/clientis-anmeldung/]
  - «Raiffeisen-Infoportal», ins LMS migriert (Kurs-ID 239), dreisprachig. [belegt: https://www.bankenberatungszentrum.ch/raiffeisen-infoportal/]
  - Daraus lässt sich schliessen, dass mit Bankengruppen Rahmenverträge mit eigenen Preisen und Prozessen bestehen. [Hypothese]

### 1.7 Lernformate
- Blended-Modell «3V-Ansatz»: Verstehen (digitaler Auftrag oder Selbststudium), Verbinden (Präsenz), Verankern (Transfer oder Test), jeweils mit eigenen Lernstunden. [belegt: https://www.bankenberatungszentrum.ch/kurs/anlagefonds-lizenz/]
- Weitere Formate: Webinare, Virtual Classroom über MS Teams, virtuelle Follow-ups. [belegt: https://www.bankenberatungszentrum.ch/kurs/praktische-anwendung-von-ki-verstehen-ausprobieren-effizient-einsetzen/]

## 2. Customer Journey

### 2.1 Anmeldewege
| Weg | Mechanik | Quelle |
|---|---|---|
| Öffentliche Kurse mit Terminen (43 Kurse, 77 Durchführungen) | «Jetzt anmelden» öffnet ein Popup mit Termintabelle (Plugin «moodle-f2f-display» 1.8.0: Datum, Ort, Status Offen/Ausgebucht/waitlist_only). «Anmelden» verlinkt auf Moodle Face-to-Face `mod/facetoface/signup.php?s=<ID>`. Moodle-Login ist Pflicht (Weiterleitung, HTTP 303). | [belegt: https://www.bankenberatungszentrum.ch/kurs/anlagefonds-lizenz/] |
| Kurse ohne Moodle-Termine (DLP, BFK UNO, Führungseinstieg) | eigene mehrstufige WPForms-Formulare | [belegt: https://www.bankenberatungszentrum.ch/kurs/diploma-leadership-practitioner-in-banking-finance/] |
| SAQ-Zertifizierung | WPForms-Formular in 5 Schritten (ID 953870) als Popup | [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/] |
| ÜK, BEM, Kontakt, Clientis | Anfrageformulare | [belegt: https://www.bankenberatungszentrum.ch/kontakt/] |
| Laut AGB | Anmeldung per Formular oder E-Mail; schriftliche Bestätigung; Berücksichtigung in der Reihenfolge des Eingangs | [belegt: https://www.bankenberatungszentrum.ch/allgemeine-geschaeftsbedingungen/] |
| Verarbeitung | WPForms, dann Zapier, dann Microsoft SharePoint/M365; E-Mail über Outlook | [belegt: https://www.bankenberatungszentrum.ch/datenschutzerklaerung-impressum/] |

Von 77 Durchführungen sind 65 offen, 6 ausgebucht und 6 nur noch auf Warteliste. Die Sessions finden vor allem an diesen Orten statt: Gleisarena FFHS Campus Zürich (36), Hotel Greuterhof Islikon (9), Riverside Zweidlen (5), Online/Webinar (9), OBC Europaallee Zürich, TKB Weinfelden, Kongresszentrum Kreuz Bern. [belegt: https://www.bankenberatungszentrum.ch/kurs/menschen-verstehen-und-fuehrung-situativ-gestalten/]

### 2.2 Formularfelder (* = Pflicht)
**A) SAQ-Anmeldung** [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/]
1. Bank* (Dropdown mit 164 Instituten, darunter «Andere»; bedingt dazu «Genossenschaft», «Bank erfassen», «Clientis-Bank») · Geschlecht* (M/W) · Vor- und Nachname* · geschäftliche E-Mail*
2. Anmeldung für* (Lehrgang zum Selbststudium / schriftliche Prüfung / mündliche Prüfung / Gesamtpaket) · bereits Lernunterlagen oder Teilprüfungen?* (bei Ja: Bemerkungen) · Profil* (PK, IK, Affluent, CWMA, KMU, CCoB) · Teilprüfungen bzw. Variante* (TP1 bis TP3, Passerelle, Erstzertifizierung; IK Finanzieren/Anlegen; PK Telefon/normal)
3. Geburtsdatum* · Privatadresse (Strasse & Nr., PLZ, Ort, Land, private E-Mail)* bedingt · Geschäftsadresse (Strasse, PLZ, Ort)* · Funktion/Rolle* (Dropdown mit 27 Rollen, die einem Profil zugeordnet sind, oder Freitext)
4. Sprache* (DE/FR/IT) · Prüfungsort und Datum schriftlich bzw. mündlich*
5. Digitale Hilfsmittel? (Ja/Nein, dazu Bestätigung des Merkblatts) · Upload Arbeitgeberbestätigung* (ohne sie keine Zulassung zur mündlichen Prüfung) · Datenschutz* · AGB* · Einverständnis, dass die Anmeldung eine **Rechnung an die Bank** auslöst* · Raiffeisen: Einwilligung zur Weitergabe von Daten und Prüfungsresultaten an Raiffeisen Schweiz*

**B) Moodle-Selbstregistrierung «mybbz»** [belegt: https://cometas.bankenberatungszentrum.ch/login/signup.php]
Anmeldename* · Kennwort* (mindestens 8 Zeichen mit Ziffer, Klein- und Grossbuchstabe sowie Sonderzeichen) · E-Mail (2×)* · Vorname* · Nachname* · Stadt · Land · Geschäftsadresse · Telefon* · Geburtsdatum* · Sprache · Profil* (Privatkunden … CCoB, Andere) · Funktion*

**C) DLP-Anmeldung** [belegt: https://www.bankenberatungszentrum.ch/kurs/diploma-leadership-practitioner-in-banking-finance/]
Anrede* · Name* · Privatadresse, PLZ, Ort* · Bank/Institut* · Geschäftsadresse, PLZ, Ort* · Rechnungsadresse identisch?* (falls nein: separate Adresse) · Funktion* · Geschäftstelefon* · E-Mail* · Mobile* · Geburtsdatum* · Name und E-Mail der vorgesetzten Person* · Instruktionen zur Verrechnung · Datenschutz* · AGB* · Lebenslauf innert 3 Arbeitstagen*

**D) BFK UNO** [belegt: https://www.bankenberatungszentrum.ch/kurs/bankfachgrundbildung-uno/]
Durchführung* (kompakt 2/2026, gesamt 1/2027, kompakt 1/2027) · mit SAQ PK?* · Personalien und Kontakt · Privatadresse und Geburtsdatum (bedingt) · Bank, Geschäfts- und Rechnungsadresse · Ansprechperson HR/Ausbildung · Bestellung «Banking Today» (CHF 450) mit Lieferadresse · Bemerkungen · Datenschutz* · AGB*

**E) Weitere Formulare**
- Führungseinstieg: wie C, aber ohne Privatadresse, Geburtsdatum, Vorgesetzte und Lebenslauf, dafür mit Ansprechperson HR und Bemerkungen; die Datenschutz-Einwilligung umfasst die Weitergabe an Monoceros-Peers. [belegt: https://www.bankenberatungszentrum.ch/kurs/so-geht-fuehrungseinstieg-heute/]
- Kontakt: Name*, E-Mail*, Nachricht, Datenschutz*, AGB*. [belegt: https://www.bankenberatungszentrum.ch/kontakt/]
- Anfrage ÜK/BEM: Anrede*, Name*, Bank*, E-Mail*, Nachricht*. [belegt: https://www.bankenberatungszentrum.ch/kurs/banking-beratung/]
- Clientis: Angebot*, Format, Anzahl Teilnehmende*, Zeitraum, Kontaktweg, Telefon*, Erreichbarkeit. [belegt: https://www.bankenberatungszentrum.ch/clientis-anmeldung/]

### 2.3 Annullierung und Umbuchung
| Fall | Regel | Quelle |
|---|---|---|
| Öffentliche Veranstaltung | Abmeldung bis mehr als 30 Tage vorher kostenlos (schriftlich). Danach, bei fehlender Abmeldung oder Abbruch, voller Preis inkl. allfälliger Stornokosten. Bezogene Lehrmittel werden immer verrechnet. Eine Ersatzperson ist kostenfrei möglich. Bei Austritt aus einem Lehrgang gibt es keine Rückzahlung. | [belegt: https://www.bankenberatungszentrum.ch/allgemeine-geschaeftsbedingungen/] |
| SAQ-Prüfung | 30 Tage bis 11 Arbeitstage vorher: CHF 300. Ab 10 Arbeitstagen ohne Arztzeugnis: voller Preis; mit Arztzeugnis: CHF 300. Abmeldung ohne absolvierte schriftliche Prüfung: Administrationsgebühr CHF 150. | ebenda |
| Absage durch bbz | Ersatztermin; ist dieser nicht wahrnehmbar, entfällt die Gebühr. Bei zu wenigen Anmeldungen Absage oder Verschiebung ohne Schadenersatz. | ebenda |
| Kundenspezifische Projekte | Bis 90 Tage vorher kostenlos. 89 bis 60 Tage: Verschiebung 10 %, Annullation 30 %. 59 bis 30 Tage: 10 % / 50 %. Ab 29 Tagen: 10 % / 100 %. Abgerechnet wird pro betroffenem Einsatztag, zuzüglich angefallener Konzeptions- und Drittkosten. | ebenda |

### 2.4 Fakturierung
- Rechnung nach Ende der Veranstaltung, zahlbar innert 30 Tagen. Danach 1. Erinnerung mit 10 Tagen Frist, ab der 2. Erinnerung CHF 50 Mahngebühr. [belegt: https://www.bankenberatungszentrum.ch/allgemeine-geschaeftsbedingungen/]
- Öffentliche, standardisierte Ausbildungen sind von der MWST befreit; Beherbergung und Verpflegung werden separat ausgewiesen. Tailor-made-Leistungen sind MWST-pflichtig, Exportleistungen nicht. Projekte werden nach Abschluss abgerechnet, Zwischenabrechnungen sind möglich, Rechnungen in vereinbarter Währung. [belegt: ebenda]
- Rechnungsempfänger ist in der Regel die Bank. Die SAQ-Anmeldung löst die Rechnung aus, sofern nicht schon bei der Bestellung der Lernunterlagen fakturiert wurde. [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/]
- Projekte: Vertrag entsteht durch eine gegengezeichnete Offerte oder eine Zusage. [belegt: https://www.bankenberatungszentrum.ch/allgemeine-geschaeftsbedingungen/]

### 2.5 Nachweise
- Es gibt diese Abschlussarten:
  - SAQ-Zertifikat [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/]
  - bbz-Diplom (BFK, Eigenheimfinanzierung) [belegt: https://www.bankenberatungszentrum.ch/kurs/eigenheimfinanzierung/]
  - «Lizenz» nach bestandenem Abschlusstest (Anlagefonds, Vorsorge) [belegt: https://www.bankenberatungszentrum.ch/kurs/vorsorge-lizenz/]
  - DLP-Diploma nach Transfernachweisen [belegt: https://www.bankenberatungszentrum.ch/kurs/transfer-center/]
  - SBVg-Zertifikat BEM [belegt: https://www.bankenberatungszentrum.ch/kurs/banking-beratung/]
- Die Website verwendet die Begriffe «Teilnahmebestätigung» und «Attest» nicht. Die Datenschutzerklärung nennt aber die «Ausstellung von Bestätigungen, Nachweisen und Zertifikaten». [belegt: https://www.bankenberatungszentrum.ch/datenschutzerklaerung-impressum/]
- Lernstunden-Bestätigungen für die Rezertifizierung entstehen vermutlich im LMS. [Hypothese]

## 3. Digitale Touchpoints und Technik
- **Website**:
  - Basis: WordPress mit Elementor 4.3.5 und Elementor Pro, Theme «Essentials» (pixfort, mit Child-Theme), Popups über Pixfort Core. [belegt: Quelltext https://www.bankenberatungszentrum.ch/]
  - Plugins: WPForms, Rank Math Pro, Complianz GDPR Premium, Google Site Kit 1.190.0, FileBird, sowie laut REST-Namespaces Wordfence, WP Super Cache, WP Mail SMTP, CPT UI und Duplicate Post. Dazu kommt das Eigen- oder Agentur-Plugin «moodle-f2f-display». [belegt: https://www.bankenberatungszentrum.ch/wp-json/]
- **Tracking**: GA4 (G-QQZKMTP7PJ) über gtag/Site Kit. [belegt: Quelltext https://www.bankenberatungszentrum.ch/]
  - Die Datenschutzerklärung nennt «Real Cookie Banner» und den Google Tag Manager. Im Quelltext ist jedoch Complianz eingebunden, die beiden Angaben stimmen also nicht überein. [belegt: https://www.bankenberatungszentrum.ch/datenschutzerklaerung-impressum/]
- **Hosting**: Hostpoint (Schweiz). Als Dienstleister werden Microsoft, Google, Cloudflare, Zapier und Intuit/Mailchimp genannt. [belegt: ebenda]
- **LMS**: Moodle «cometas LMS Bankenberatungszentrum», Marke «mybbz», unter https://cometas.bankenberatungszentrum.ch.
  - Version 2024100715.01, also etwa Moodle 4.5. [belegt: https://cometas.bankenberatungszentrum.ch/login/index.php]
  - Selbstregistrierung ist aktiv; Sprachen de_ch, de, en, fr, it. [belegt: ebenda]
  - Betreiber ist die cometas.ch gmbh in Basel (Hosting in der Schweiz, Auftragsverarbeitungsvertrag). [belegt: https://www.bankenberatungszentrum.ch/datenschutzerklaerung-impressum/]
- **Newsletter und Einladungen**: Mailchimp, nur für Kundenveranstaltungen. Auf der Website gibt es kein Newsletter-Anmeldeformular. [belegt: ebenda]
- **Weitere Kanäle**: LinkedIn, MS Teams und MS Forms in Kursen, ICS-Download für Events, Monoceros-Peers-App. [belegt: https://www.bankenberatungszentrum.ch/kurs/vorbereitung-schriftliche-saq-zertifizierung/]
- **Defekte Links**: Die SAQ-«Publikationen» (`/saq_*`) leiten auf die Startseite um [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/], und «Bewerbung einreichen» zeigt auf eine nicht öffentliche Seiten-ID. [belegt: https://www.bankenberatungszentrum.ch/karriere/]

## 4. Organisation
- **Firma**: Bankenberatungszentrum, bbz st.gallen ag, Zürcherstrasse 202, 9014 St. Gallen.
  - Kontakt: 071 274 02 40, info@ bzw. saq-zertifizierung@bankenberatung.ch.
  - Erreichbar Mo bis Fr 07:30 bis 17:00; Antwort in der Regel innert eines Arbeitstags.
  - [belegt: https://www.bankenberatungszentrum.ch/kontakt/]
- **Gründung**: Laut Website 1999. [belegt: https://www.bankenberatungszentrum.ch/ueber-uns/] Ein Presseartikel schreibt «seit 1974», die beiden Angaben widersprechen sich. [belegt: https://www.finews.ch/news/banken/70810 (leitet auf den vollständigen Artikel weiter)]
- **Führung**: Ein vierköpfiges Senior-Partnergremium hat die operative Leitung übernommen; der bisherige geschäftsführende Partner wechselt in den Verwaltungsrat. Strategische Geschäftsfelder sind Nachwuchs, Weiterbildung, SAQ-Zertifizierungen und Tailormade. [belegt: https://www.finews.ch/news/banken/70810]
- **Team**: 31 Einträge, eingeteilt nach Geschäftsfeld (Mehrfachzuordnung möglich):
  - Trainer/in 17 (davon 14 ausschliesslich in dieser Rolle)
  - Partner 7
  - Beratung & Services 6
  - Nachwuchsbildung 4
  - SAQ-Zertifizierung 4
  - Operations 3
  - Tailormade-Projekte 2
  - Weiterbildung 2
  - Einzelne Rollenbezeichnungen: «Key Accounting», «Medien & Kommunikation», «Leiter Zürich & Westschweiz» (Nachwuchsbildung).
  - [belegt: https://www.bankenberatungszentrum.ch/team/] [belegt: https://www.bankenberatungszentrum.ch/wp-json/wp/v2/bbz_team]
- **Referentenmodell**:
  - Die AGB nennen Referent/innen, Assessor/innen und Veranstaltungsbetreuer/innen, die ersetzt werden können, sowie externe Referent/innen als Drittkosten. [belegt: https://www.bankenberatungszentrum.ch/allgemeine-geschaeftsbedingungen/]
  - Im DLP unterrichten Referierende aus Wirtschaft, Psychologie und Spitzensport. [belegt: https://www.bankenberatungszentrum.ch/kurs/diploma-leadership-practitioner-in-banking-finance/]
  - Die Team-Trainer sind vermutlich teils freie Mitarbeitende. [Hypothese]
- **Standorte**: Sitz in St. Gallen; Kurse vor allem in Zürich (FFHS-Campus) und in Seminarhotels; Prüfungen in Zürich, St. Gallen, Lausanne, Vezia und remote. [belegt: Kursseiten und Terminseiten oben] Ein eigener Standort in Zürich ist nicht belegt. [Hypothese]
- **Partner**:
  - SAQ als Zertifizierungsstelle. [belegt: https://www.bankenberatungszentrum.ch/rezertifizierung/] Dass bbz selbst die «Prüfungsstelle» ist, legt der Begriff im FAQ nahe (https://www.bankenberatungszentrum.ch/zertifizierung/), ausdrücklich steht es dort aber nicht. [Hypothese]
  - SBVg / Swiss Banking (BEM, ÜK, Praxisausbildende). [belegt: https://www.bankenberatungszentrum.ch/kurs/training-fuer-praxisausbildende/]
  - Centro Studi Villa Negroni (Prüfungen auf Italienisch). [belegt: https://www.bankenberatungszentrum.ch/zertifizierung/]
  - cometas (Betreiber des LMS); Monoceros-Peers (Führungseinstieg).
  - Raiffeisen und Clientis (gruppenspezifische Angebote und Seiten).
  - UKB und TKB als Kursorte.
  - Ein Hochschulpartner wurde nicht gefunden.

## 5. Regulatorischer Kontext
- **SAQ-Personenzertifizierung «Kundenberater Bank»**:
  - Sechs Profile; 3 Jahre Gültigkeit; 24 LS in 36 Monaten; Komponenten «Fachwissen» und «Verhalten»; zusätzlich gilt das SAQ-Prüfungsreglement. [belegt: https://www.bankenberatungszentrum.ch/rezertifizierung/] [belegt: https://www.bankenberatungszentrum.ch/allgemeine-geschaeftsbedingungen/]
  - Laut Websuche verlangt die SAQ, dass anerkannte Massnahmen beide Komponenten abdecken. [belegt via Suchsnippet: https://personenzertifizierung.ch/en/downloads/personenzertifizierung/kundenberater-bank/anerkennung-rezertifizierungsmassnahmen/richtlinien-zur-einreichung-von-rezertifizierungsmassnahmen.pdf] Die SAQ-Anbieterliste war aus der Session nicht abrufbar.
- **Arbeitgeberbestätigung (SAQ-Formular)**:
  - Voraussetzungen: Anstellung bei einem Finanzinstitut, Kundenbuch oder direkter Kundenkontakt, gültige Rolle gemäss Rollenschlüssel.
  - Für unabhängige Vermögensverwalter (UVV): Rahmenvertrag mit einer Bank sowie SRO-Mitgliedschaft oder FINMA-Bewilligung.
  - Unterschrift und Stempel des Arbeitgebers.
  - [belegt: https://www.bankenberatungszentrum.ch/wp-content/uploads/2026/10/SAQ_bestaetigung_arbeitgeber_0325_DE.pdf]
- **Elektronische Hilfsmittel**: PDF, Office und öffentliche Webseiten sind erlaubt. Zugriffe auf das Kernbankensystem («Full-Use») sind nur mit SAQ-Zulassung erlaubt. Die Hilfsmittel werden im Prüfungsdossier archiviert. [belegt: https://www.bankenberatungszentrum.ch/wp-content/uploads/2026/10/Merkblatt_elektronische_Hilfsmittel_0424_DE.pdf]
- **Inhaltliche Bezüge**:
  - «ISO-Anforderungen» bei Anlagefonds-, Vorsorge- und Eigenheimkursen. [belegt: https://www.bankenberatungszentrum.ch/kurs/anlagefonds-lizenz/] Gemeint ist vermutlich ISO/IEC 17024. [Hypothese]
  - FIDLEG-Aufklärungspflicht (Derivate «Basic»). [belegt: https://www.bankenberatungszentrum.ch/kurs/derivate-und-strukturierte-produkte-basic/]
  - Geldwäscherei und Compliance als Inhalt der BFK. [belegt: https://www.bankenberatungszentrum.ch/kurs/bankfachgrundbildung-fuer-erwachsene-mit-saq-zertifizierung/]
  - SBVg-Richtlinien zur Energieeffizienz. [belegt: https://www.bankenberatungszentrum.ch/kurs/sustainable-finance-fokusmodul-finanzieren/]
- **Rechtsrahmen bbz**:
  - Die Mitarbeitenden unterstehen dem Bankgeheimnis; Gerichtsstand St. Gallen. [belegt: https://www.bankenberatungszentrum.ch/allgemeine-geschaeftsbedingungen/]
  - Datenschutz nach DSG (EDÖB); Übermittlung in die USA über das Swiss-U.S. Data Privacy Framework oder Standardvertragsklauseln. [belegt: https://www.bankenberatungszentrum.ch/datenschutzerklaerung-impressum/]
- Kein eigenes GwG- oder Compliance-Produkt gefunden.

## 6. ERP-relevante Ableitungen [Hypothese]
- **Stammdaten**: Institut/Bank (mit Gruppe, Raiffeisen, Clientis, UVV), Person (privat und geschäftlich, Geburtsdatum, Rolle → SAQ-Profil), Kurs, Modul, Durchführung, Ort, Referent/Assessor, Preisregel (Staffel, Nebenkosten-Pauschalen pro Jahr), Prüfungstermin mit Kapazität.
- **Prozesse**:
  - Anmeldung → Bestätigung → Durchführung → Rechnung → Mahnung (zwei Stufen, Gebühr)
  - Storno-Regelwerk (30 Tage, Arbeitstage, Arztzeugnis)
  - SAQ-Prüfungsadministration (Arbeitgeberbestätigung, Hilfsmittelprüfung, Resultate, Weitergabe an Raiffeisen)
  - Rezertifizierungskonto mit 24 LS pro 36 Monate
  - Lehrmittelbestellung und Lieferung
  - Offerte → Projekt → Zwischenabrechnung
- **Integrationen**: Moodle (Face-to-Face-Sessions und Benutzer), WPForms/Zapier/SharePoint, Mailchimp, M365.
- **Heute doppelt gepflegt**: Prüfungstermine stehen sowohl auf den Terminseiten als auch im SAQ-Formular, Kurstermine in Moodle. Ein gemeinsames Termin-Stammdatum fehlt.
