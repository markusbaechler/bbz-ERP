import { SAQ_VERRECHNUNG } from '../config/saq';
import { rappenRunden } from './mwst';

const tag = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86400_000;

/** Arbeitstage (Mo-Fr, ohne Feiertage) nach `von` bis einschliesslich `bis`; 0, wenn bis <= von. */
export function arbeitstageZwischen(von: string, bis: string): number {
  let n = 0;
  for (let t = tag(von) + 1; t <= tag(bis); t++) {
    const wochentag = new Date(t * 86400_000).getUTCDay();
    if (wochentag !== 0 && wochentag !== 6) n++;
  }
  return n;
}

export type SaqAnnullation = { gebuehrChf: number; regel: string; kalendertage: number | null; arbeitstage: number | null };

/**
 * Annullationskosten einer SAQ-Anmeldung [belegt: AGB, siehe config/saq.ts]. Massgebend ist die naechste geplante
 * Pruefung. Ohne absolvierte schriftliche Pruefung gilt mindestens die Administrationsgebuehr [Hypothese: hoeherer Betrag].
 */
export function saqAnnullation(input: {
  preisChf: number; stornoDatum: string; naechstePruefung: string | null; arztzeugnis?: boolean; schriftlichAbsolviert: boolean;
}): SaqAnnullation {
  const a = SAQ_VERRECHNUNG.annullation;
  let gebuehr = 0; let regel = 'kostenlos';
  let kalendertage: number | null = null; let arbeitstage: number | null = null;
  if (input.naechstePruefung) {
    kalendertage = tag(input.naechstePruefung) - tag(input.stornoDatum);
    arbeitstage = arbeitstageZwischen(input.stornoDatum, input.naechstePruefung);
    if (kalendertage > a.freiMehrAlsTage) { gebuehr = 0; regel = `mehr als ${a.freiMehrAlsTage} Tage vor der Pruefung: kostenlos`; }
    else if (arbeitstage > a.vollerPreisAbArbeitstagen) { gebuehr = a.pauschalChf; regel = `30 Tage bis 11 Arbeitstage vor der Pruefung: CHF ${a.pauschalChf}`; }
    else if (input.arztzeugnis) { gebuehr = a.pauschalChf; regel = `weniger als 11 Arbeitstage, mit Arztzeugnis: CHF ${a.pauschalChf}`; }
    else { gebuehr = input.preisChf; regel = 'weniger als 11 Arbeitstage ohne Arztzeugnis: voller Preis'; }
  }
  if (!input.schriftlichAbsolviert && gebuehr < a.administrationChf) {
    gebuehr = a.administrationChf; regel = `Abmeldung ohne absolvierte schriftliche Pruefung: Administrationsgebuehr CHF ${a.administrationChf}`;
  }
  return { gebuehrChf: rappenRunden(gebuehr), regel, kalendertage, arbeitstage };
}
