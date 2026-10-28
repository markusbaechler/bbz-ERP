import { describe, it, expect } from 'vitest';
import { normalisiereFormular, datumAus, profilAus, anredeAus, umfangAus, varianteAus, jaNein } from '../src/integrations/formulare';

describe('Formular-Mapping (WPForms/Zapier)', () => {
  it('Hilfsfunktionen: Datum, Profil, Anrede, Umfang, Variante, Ja/Nein', () => {
    expect(datumAus('3.7.1985')).toBe('1985-07-03');
    expect(datumAus('1985-07-03')).toBe('1985-07-03');
    expect(datumAus('31.02.1985')).toBeNull();
    expect(['PK', 'Individualkunden', 'Affluent', 'CWMA', 'KMU', 'CCoB', 'xyz'].map(profilAus)).toEqual(['PK', 'IK', 'AFFL', 'CWMA', 'KMU', 'CCoB', null]);
    expect([anredeAus('W'), anredeAus('M'), anredeAus('Herr'), anredeAus('divers')]).toEqual(['Frau', 'Herr', 'Herr', null]);
    expect(umfangAus('Lehrgang zum Selbststudium')).toBe('selbststudium');
    expect(umfangAus('mündliche Prüfung')).toBe('muendlich');
    expect(varianteAus('TP2')).toBe('teilpruefung');
    expect(varianteAus('Passerelle')).toBe('passerelle');
    expect([jaNein('Ja'), jaNein('1'), jaNein('Ich stimme zu'), jaNein('Nein'), jaNein(null)]).toEqual([true, true, true, false, false]);
  });

  it('Kontaktformular -> Anfrage; Name wird zerlegt, Labels der Website werden erkannt', () => {
    const r = normalisiereFormular('kontakt', { Name: 'Erika Muster', 'E-Mail': 'Erika@Bank.TEST', Nachricht: 'Bitte Rückruf', Datenschutz: 'Ja', AGB: 'Ja' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.befehl).toMatchObject({ art: 'anfrage', typ: 'kontakt', nachricht: 'Bitte Rückruf', kontakt: { vorname: 'Erika', nachname: 'Muster', email: 'erika@bank.test' } });
  });

  it('verlangt Datenschutz/AGB und gueltige E-Mail', () => {
    const r = normalisiereFormular('kontakt', { name: 'X', email: 'kaputt' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fehler).toEqual(expect.arrayContaining(['Gueltige E-Mail fehlt', 'Einwilligung Datenschutz fehlt', 'AGB nicht akzeptiert']));
  });

  it('SAQ-Anmeldung (5 Schritte der Website) -> SAQ-Fall', () => {
    const r = normalisiereFormular('saq-anmeldung', {
      Bank: 'Raiffeisenbank Muster', Geschlecht: 'W', 'Vor- und Nachname': 'Erika Muster', 'Geschäftliche E-Mail': 'erika@raiffeisen.test',
      'Anmeldung für': 'Gesamtpaket', Profil: 'Affluent', Teilprüfungen: 'Erstzertifizierung', Geburtsdatum: '03.07.1985',
      'Funktion/Rolle': 'Kundenberaterin Affluent', Sprache: 'Deutsch', 'Digitale Hilfsmittel': 'Nein',
      Datenschutz: 'Ja', AGB: 'Ja', 'Einverständnis Rechnung an Bank': 'Ja', 'Einwilligung Raiffeisen': 'Ja',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.befehl).toMatchObject({
      art: 'saq', profil: 'AFFL', umfang: 'gesamtpaket', variante: 'erstzertifizierung', sprache: 'DE', organisationName: 'Raiffeisenbank Muster',
      einwilligungRechnungBank: true, einwilligungWeitergabeGruppe: true, digitaleHilfsmittel: false,
      kontakt: { anrede: 'Frau', vorname: 'Erika', nachname: 'Muster', geburtsdatum: '1985-07-03' },
    });
  });

  it('SAQ ohne Rechnungs-Einverstaendnis oder ohne Profil wird abgelehnt', () => {
    const r = normalisiereFormular('saq-anmeldung', { name: 'A B', email: 'a@b.ch', Bank: 'X', Datenschutz: 'Ja', AGB: 'Ja' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fehler).toEqual(expect.arrayContaining(['Einverstaendnis zur Rechnung an die Bank fehlt', 'Profil fehlt oder unbekannt: –']));
  });

  it('Lehrgangs-Anmeldung mit ERP-Durchfuehrungscode -> Anmeldung, sonst Offertanfrage', () => {
    const basis = { Anrede: 'Herr', Vorname: 'Max', Nachname: 'Beispiel', 'E-Mail': 'max@bank.test', Bank: 'UKB', Datenschutz: 'on', AGB: 'on' };
    const a = normalisiereFormular('dlp', { ...basis, Durchführung: 'dlp-2027-1', 'Instruktionen zur Verrechnung': 'KST 4711' });
    expect(a.ok && a.befehl).toMatchObject({ art: 'anmeldung', durchfuehrungCode: 'DLP-2027-1', rechnungsreferenz: 'KST 4711' });
    const b = normalisiereFormular('bfk-uno', { ...basis, Durchführung: 'kompakt 2/2026' });
    expect(b.ok && b.befehl).toMatchObject({ art: 'anfrage', typ: 'offerte', interesse: 'nachwuchs' });
    expect(b.ok && (b.befehl as any).nachricht).toContain('Gewünschte Durchführung: kompakt 2/2026');
  });

  it('unbekanntes Formular', () => {
    expect(normalisiereFormular('gibtsnicht', {})).toEqual({ ok: false, fehler: ['Unbekanntes Formular: gibtsnicht'] });
  });
});
