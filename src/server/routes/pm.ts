// REST-Routen Projektmanagement (Spec v2 §5.3). Lesen/Schreiben fuer alle Mitarbeitenden;
// Admin-only: Zeit verrechnen, Abschluss mit force, Ueberbuchung erzwingen, Loeschen von Phasen/Meilensteinen.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import {
  AUFGABE_STATUS, PROJEKT_STATUS, pruefeDatum, type AufgabeStatus, type ProjektStatus,
} from '../../domain/pmTypes';
import type { EinsatzStatus } from '../../domain/types';
import { heuteIso } from '../../domain/cockpit';
import { ValidationError } from '../../domain/errors';
import { updateProjekt, setProjektStatus, fortsetzeProjekt } from '../../repos/projektRepo';
import { createPhase, listPhasen, updatePhase, deletePhase } from '../../repos/phaseRepo';
import {
  createMeilenstein, listMeilensteine, updateMeilenstein, setMeilensteinErreicht, deleteMeilenstein,
} from '../../repos/meilensteinRepo';
import {
  createAufgabe, getAufgabe, updateAufgabe, deleteAufgabe, listAufgaben, verschiebeAufgabe,
} from '../../repos/aufgabeRepo';
import {
  createZeiterfassung, getZeiterfassung, listZeiterfassung, updateZeiterfassung, deleteZeiterfassung, zeitVerrechnen,
} from '../../repos/zeiterfassungRepo';
import { createEinsatz, listEinsaetze, setEinsatzStatus } from '../../repos/einsatzRepo';
import { findMitarbeitendeByKuerzel } from '../../repos/mitarbeitendeRepo';
import { getCockpit, getPortfolio, getKanban, getGantt, getAuslastung } from '../../repos/pmAuswertungRepo';

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
/** Fachfehler einheitlich abbilden (400/404/409). */
const h = (fn: Handler): Handler => async (req, reply) => {
  try { return await fn(req, reply); } catch (e) { return sendError(reply, e); }
};

const EINSATZ_STATUS: readonly EinsatzStatus[] = ['angefragt', 'bestaetigt', 'abgesagt', 'durchgefuehrt'];

/** Query-Liste: "a,b" oder ?x=a&x=b; optional gegen erlaubte Werte geprueft. */
export function queryListe<T extends string>(v: unknown, feld: string, erlaubt?: readonly T[]): T[] | undefined {
  if (v === undefined || v === '') return undefined;
  const werte = (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);
  if (erlaubt) for (const w of werte) if (!erlaubt.includes(w as T)) throw new ValidationError(`${feld}: ungueltiger Wert ${w}`);
  return werte as T[];
}

export function queryBool(v: unknown, feld: string): boolean | undefined {
  if (v === undefined || v === '') return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ValidationError(`${feld} muss true oder false sein`);
}

export function queryZahl(v: unknown, feld: string): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${feld} muss eine Zahl sein`);
  return n;
}

const body = (req: FastifyRequest): any => req.body ?? {};
const id = (req: FastifyRequest): string => (req.params as any).id;
const query = (req: FastifyRequest): any => req.query ?? {};

export function registerPmRoutes(app: FastifyInstance, pool: pg.Pool): void {
  // --- Projekt (Erweiterungen; Liste/Detail/Anlage in routes/projekt.ts) ---
  app.get('/projekt/portfolio', h(async (req) => {
    const q = query(req);
    return getPortfolio(pool, {
      jahr: queryZahl(q.jahr, 'jahr'), status: queryListe<ProjektStatus>(q.status, 'status', PROJEKT_STATUS),
      projektleitungId: q.projektleitungId || undefined, auftraggeberId: q.auftraggeberId || undefined,
    }, q.heute || heuteIso());
  }));
  app.patch('/projekt/:id', h(async (req) => updateProjekt(pool, id(req), body(req))));
  app.post('/projekt/:id/status', h(async (req, reply) => {
    const b = body(req);
    if (b.force === true && req.rolle !== 'admin') return reply.code(403).send({ error: 'force nur fuer Admin' });
    return setProjektStatus(pool, id(req), b.status, { force: b.force === true, benutzer: req.benutzer });
  }));
  app.post('/projekt/:id/fortsetzen', h(async (req, reply) =>
    reply.code(201).send(await fortsetzeProjekt(pool, id(req), body(req).jahr))));
  app.get('/projekt/:id/cockpit', h(async (req) => getCockpit(pool, id(req), query(req).heute || heuteIso())));
  app.get('/projekt/:id/kanban', h(async (req) => getKanban(pool, id(req))));
  app.get('/projekt/:id/gantt', h(async (req) => getGantt(pool, id(req), query(req).heute || heuteIso())));
  app.post('/projekt/:id/zeit-verrechnen', { preHandler: requireAdmin }, h(async (req, reply) => {
    const b = body(req);
    const res = await zeitVerrechnen(pool, id(req), b, { benutzer: req.benutzer });
    return reply.code(b.rechnungId ? 200 : 201).send(res);
  }));

  // --- Phasen ---
  app.get('/projekt/:id/phase', h(async (req) => listPhasen(pool, id(req))));
  app.post('/projekt/:id/phase', h(async (req, reply) => reply.code(201).send(await createPhase(pool, id(req), body(req)))));
  app.patch('/phase/:id', h(async (req) => updatePhase(pool, id(req), body(req))));
  app.delete('/phase/:id', { preHandler: requireAdmin }, h(async (req, reply) => {
    await deletePhase(pool, id(req));
    return reply.code(204).send();
  }));

  // --- Meilensteine ---
  app.get('/projekt/:id/meilenstein', h(async (req) => listMeilensteine(pool, id(req))));
  app.post('/projekt/:id/meilenstein', h(async (req, reply) =>
    reply.code(201).send(await createMeilenstein(pool, id(req), body(req)))));
  app.patch('/meilenstein/:id', h(async (req) => updateMeilenstein(pool, id(req), body(req))));
  app.post('/meilenstein/:id/erreicht', h(async (req) => setMeilensteinErreicht(pool, id(req), body(req).datum ?? heuteIso())));
  app.delete('/meilenstein/:id', { preHandler: requireAdmin }, h(async (req, reply) => {
    await deleteMeilenstein(pool, id(req));
    return reply.code(204).send();
  }));

  // --- Aufgaben (Projekt + CRM-Wiedervorlagen) ---
  app.get('/aufgabe', h(async (req) => {
    const q = query(req);
    return listAufgaben(pool, {
      projektId: q.projektId || undefined, zustaendigId: q.zustaendigId || undefined, kontaktId: q.kontaktId || undefined,
      organisationId: q.organisationId || undefined, verkaufschanceId: q.verkaufschanceId || undefined,
      phaseId: q.phaseId || undefined, status: queryListe<AufgabeStatus>(q.status, 'status', AUFGABE_STATUS),
      ueberfaellig: queryBool(q.ueberfaellig, 'ueberfaellig'), ohneProjekt: queryBool(q.ohneProjekt, 'ohneProjekt'),
      faelligBis: q.faelligBis || undefined, heute: q.heute || undefined,
    });
  }));
  app.get('/aufgabe/:id', h(async (req) => getAufgabe(pool, id(req))));
  app.post('/aufgabe', h(async (req, reply) =>
    reply.code(201).send(await createAufgabe(pool, body(req), { erstelltDurch: req.benutzer }))));
  app.patch('/aufgabe/:id', h(async (req) => updateAufgabe(pool, id(req), body(req))));
  app.delete('/aufgabe/:id', h(async (req, reply) => {
    await deleteAufgabe(pool, id(req));
    return reply.code(204).send();
  }));
  app.post('/aufgabe/:id/verschieben', h(async (req) => verschiebeAufgabe(pool, id(req), body(req))));

  // --- Zeiterfassung ---
  app.get('/zeiterfassung', h(async (req) => {
    const q = query(req);
    return listZeiterfassung(pool, {
      projektId: q.projektId || undefined, mitarbeitendeId: q.mitarbeitendeId || undefined,
      von: q.von || undefined, bis: q.bis || undefined,
      verrechnet: queryBool(q.verrechnet, 'verrechnet'), verrechenbar: queryBool(q.verrechenbar, 'verrechenbar'),
    });
  }));
  app.get('/zeiterfassung/:id', h(async (req) => getZeiterfassung(pool, id(req))));
  app.post('/zeiterfassung', h(async (req, reply) => {
    const b = { ...body(req) };
    if (!b.mitarbeitendeId) {
      // Default: angemeldete Person (Kuerzel aus Auth)
      const ma = req.benutzer ? await findMitarbeitendeByKuerzel(pool, req.benutzer) : null;
      if (!ma) throw new ValidationError('mitarbeitendeId ist Pflicht (angemeldete Person nicht als Mitarbeitende erfasst)');
      b.mitarbeitendeId = ma.id;
    }
    return reply.code(201).send(await createZeiterfassung(pool, b));
  }));
  app.patch('/zeiterfassung/:id', h(async (req) => updateZeiterfassung(pool, id(req), body(req))));
  app.delete('/zeiterfassung/:id', h(async (req, reply) => {
    await deleteZeiterfassung(pool, id(req));
    return reply.code(204).send();
  }));

  // --- Einsatzplanung (Ueberbuchungsschutz §5.1) ---
  app.get('/einsatz', h(async (req) => {
    const q = query(req);
    return listEinsaetze(pool, {
      referentId: q.referentId || undefined, projektId: q.projektId || undefined, kurstagId: q.kurstagId || undefined,
      von: q.von || undefined, bis: q.bis || undefined, status: queryListe<EinsatzStatus>(q.status, 'status', EINSATZ_STATUS),
    });
  }));
  app.post('/einsatz', h(async (req, reply) => {
    const b = body(req);
    if (b.ueberbuchungErlauben === true && req.rolle !== 'admin') return reply.code(403).send({ error: 'Ueberbuchung erzwingen nur fuer Admin' });
    if (!b.referentId) throw new ValidationError('referentId ist Pflicht');
    if (!b.projektId) throw new ValidationError('projektId ist Pflicht');
    if (b.status !== undefined && !EINSATZ_STATUS.includes(b.status)) throw new ValidationError(`status muss ${EINSATZ_STATUS.join('|')} sein`);
    pruefeDatum('datum', b.datum, true);
    return reply.code(201).send(await createEinsatz(pool, b));
  }));
  app.post('/einsatz/:id/status', h(async (req) => {
    const status = body(req).status;
    if (!EINSATZ_STATUS.includes(status)) throw new ValidationError(`status muss ${EINSATZ_STATUS.join('|')} sein`);
    return setEinsatzStatus(pool, id(req), status);
  }));
  app.get('/ressourcen/auslastung', h(async (req) => {
    const q = query(req);
    return getAuslastung(pool, { von: q.von, bis: q.bis, referentId: q.referentId || undefined });
  }));
}
