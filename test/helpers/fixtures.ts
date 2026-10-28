import type pg from 'pg';
import { createAuftraggeber } from '../../src/repos/auftraggeberRepo';
import { createProjekt } from '../../src/repos/projektRepo';
import { createMitarbeitende } from '../../src/repos/mitarbeitendeRepo';

/** Minimaler Grundbestand fuer Modultests: Mitarbeitende ml (admin), Auftraggeber, Projekt 6231.26. */
export async function grundbestand(pool: pg.Pool) {
  const ml = await createMitarbeitende(pool, { kuerzel: 'ml', vorname: 'Markus', nachname: 'Muster', email: 'ml@bbz.test', rolle: 'admin', stundensatzIntern: 90, stundensatzVerrechnung: 220 });
  const auftraggeber = await createAuftraggeber(pool, { nummer: '20577', name: 'Urner Kantonalbank', strasse: 'Bahnhofstrasse 1', plz: '6460', ort: 'Altdorf' });
  const projekt = await createProjekt(pool, { stammnummer: 6231, jahr: 2026, name: 'Testprojekt', auftraggeberId: auftraggeber.id, budgetChf: 20000 });
  return { ml, auftraggeber, projekt };
}
