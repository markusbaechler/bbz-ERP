import type { Db } from './db';
import { inTransaktion } from './db';
import type pg from 'pg';
import { SAQ_PROFIL_INFO, SAQ_VERRECHNUNG } from '../config/saq';
import { saqAnnullation, type SaqAnnullation } from '../domain/saqAnnullation';
import { istOffen } from '../domain/saq';
import type { SaqProfil, SaqStatus } from '../domain/saqTypes';
import { createRechnung, addPosition, getRechnung, listPositionen } from './rechnungRepo';
import { getProjektById } from './projektRepo';
import { audit } from './auditRepo';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';

/*
 * SAQ-Verrechnung (Spec v2 §5.4b/§5.5): "Die Anmeldung loest eine Rechnung an die Bank aus" [belegt: SAQ-Formular].
 * Projekt = Kostentraeger (z. B. Jahresprojekt "SAQ-Zertifizierung 2026"); Preis = Listenpreis des Profils, ueberschreibbar
 * (Preise je Institut variabel), Remote-Aufpreis wenn eine Pruefung remote geplant ist.
 */

async function ladeFall(c: Db, id: string) {
  const r = await c.query(
    `select f.*, trim(concat_ws(' ', k.vorname, k.nachname)) as name,
            exists (select 1 from saq_pruefung p where p.fall_id=f.id and p.remote) as remote,
            exists (select 1 from saq_pruefung p where p.fall_id=f.id and p.art='schriftlich' and p.bestanden is not null) as schriftlich_absolviert,
            (select min(p.datum) from saq_pruefung p where p.fall_id=f.id and p.bestanden is null) as naechste_pruefung
     from saq_fall f join kontakt k on k.id=f.kontakt_id where f.id=$1 for update of f`, [id]);
  if (!r.rowCount) throw new NotFoundError(`SAQ-Vorgang ${id} nicht gefunden`);
  return r.rows[0];
}

export async function verrechneSaqFall(pool: pg.Pool, fallId: string, input: { datum: string; projektId: string; preisChf?: number | null }, benutzer: string | null = null) {
  if (!input?.datum || !input.projektId) throw new ValidationError('datum und projektId (Kostentraeger) sind Pflicht');
  return inTransaktion(pool, async (c) => {
    const f = await ladeFall(c, fallId);
    if (f.rechnung_id) throw new ConflictError('SAQ-Vorgang ist bereits verrechnet');
    if (!f.rechnungsempfaenger_id) throw new ValidationError('Rechnungsempfaenger (Debitor der Bank) fehlt');
    if (!f.einwilligung_rechnung_bank) throw new ValidationError('Einwilligung zur Rechnung an die Bank fehlt');
    const projekt = await getProjektById(c, input.projektId);
    const profil = f.profil as SaqProfil;
    const preis = input.preisChf ?? SAQ_PROFIL_INFO[profil].listenpreisChf;
    if (!(preis > 0)) throw new ValidationError('preisChf muss > 0 sein');
    const rechnung = await createRechnung(c, { projektId: projekt.id, auftraggeberId: f.rechnungsempfaenger_id, datum: input.datum,
      betreff: `SAQ-Zertifizierung Kundenberater Bank – ${SAQ_PROFIL_INFO[profil].bezeichnung}` });
    await addPosition(c, rechnung.id, { beschreibung: `SAQ-Zertifizierung ${profil} (${f.umfang}) – ${f.name}`, menge: 1, einheit: 'Pauschal',
      einzelpreis: preis, mwstSatz: SAQ_VERRECHNUNG.mwstSatz, kontoId: projekt.ertragskontoId });
    if (f.remote) {
      await addPosition(c, rechnung.id, { beschreibung: `Aufpreis Remote-Pruefung – ${f.name}`, menge: 1, einheit: 'Pauschal',
        einzelpreis: SAQ_VERRECHNUNG.remoteAufpreisChf, mwstSatz: SAQ_VERRECHNUNG.mwstSatz, kontoId: projekt.ertragskontoId });
    }
    await c.query('update saq_fall set rechnung_id=$2, geaendert_am=now() where id=$1', [fallId, rechnung.id]);
    await audit(c, { benutzer, aktion: 'saq_verrechnet', entitaet: 'saq_fall', entitaetId: fallId, details: { rechnungId: rechnung.id, preis } });
    return { ...(await getRechnung(c, rechnung.id)), positionen: await listPositionen(c, rechnung.id) };
  });
}

/** Abmeldung/Abbruch: Status abgebrochen, Annullationskosten nach AGB; ohne bestehende Rechnung wird die Gebuehr verrechnet. */
export async function storniereSaqFall(pool: pg.Pool, fallId: string,
  input: { datum: string; grund: string; arztzeugnis?: boolean; projektId?: string | null }, benutzer: string | null = null,
): Promise<{ annullation: SaqAnnullation; rechnungId: string | null; hinweis: string | null }> {
  if (!input?.datum || !input.grund?.trim()) throw new ValidationError('datum und grund sind Pflicht');
  return inTransaktion(pool, async (c) => {
    const f = await ladeFall(c, fallId);
    if (!istOffen(f.status as SaqStatus)) throw new ConflictError(`Vorgang ist bereits abgeschlossen (Status ${f.status})`);
    const preis = SAQ_PROFIL_INFO[f.profil as SaqProfil].listenpreisChf;
    const annullation = saqAnnullation({ preisChf: preis, stornoDatum: input.datum, naechstePruefung: f.naechste_pruefung,
      arztzeugnis: input.arztzeugnis, schriftlichAbsolviert: f.schriftlich_absolviert });
    await c.query(
      `update saq_fall set status='abgebrochen', storniert_am=$2, stornogebuehr_chf=$3, geaendert_am=now(),
         bemerkung=concat_ws(E'\\n', bemerkung, $4::text) where id=$1`,
      [fallId, input.datum, annullation.gebuehrChf, `Abmeldung ${input.datum}: ${input.grund.trim()} (${annullation.regel})`]);
    let rechnungId: string | null = null; let hinweis: string | null = null;
    if (f.rechnung_id) {
      hinweis = 'Bereits verrechnet: Differenz zur Annullationsgebuehr per Gutschrift/Storno der Rechnung korrigieren';
    } else if (annullation.gebuehrChf > 0) {
      if (!input.projektId || !f.rechnungsempfaenger_id) {
        hinweis = 'Annullationsgebuehr erfasst, aber nicht verrechnet (projektId oder Rechnungsempfaenger fehlt)';
      } else {
        const projekt = await getProjektById(c, input.projektId);
        const r = await createRechnung(c, { projektId: projekt.id, auftraggeberId: f.rechnungsempfaenger_id, datum: input.datum, betreff: 'Annullation SAQ-Zertifizierung' });
        await addPosition(c, r.id, { beschreibung: `Annullationskosten SAQ ${f.profil} – ${f.name} (${annullation.regel})`, menge: 1, einheit: 'Pauschal',
          einzelpreis: annullation.gebuehrChf, mwstSatz: SAQ_VERRECHNUNG.mwstSatz, kontoId: projekt.ertragskontoId });
        await c.query('update saq_fall set rechnung_id=$2 where id=$1', [fallId, r.id]);
        rechnungId = r.id;
      }
    }
    await audit(c, { benutzer, aktion: 'saq_storniert', entitaet: 'saq_fall', entitaetId: fallId, details: { ...annullation, rechnungId } });
    return { annullation, rechnungId, hinweis };
  });
}
