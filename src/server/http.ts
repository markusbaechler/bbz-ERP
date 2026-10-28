import type { FastifyReply } from 'fastify';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';

/** Einheitliche Abbildung fachlicher Fehler auf HTTP-Status. Unbekannte Fehler werden weitergeworfen (-> 500). */
export function sendError(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
  if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
  if (e instanceof ConflictError) return reply.code(409).send({ error: e.message });
  if (isPgError(e) && e.code === '23505') return reply.code(409).send({ error: 'Datensatz existiert bereits', detail: e.detail });
  if (isPgError(e) && e.code === '23503') return reply.code(400).send({ error: 'Verweis auf nicht vorhandenen Datensatz', detail: e.detail });
  if (isPgError(e) && (e.code === '23514' || e.code === '22P02')) return reply.code(400).send({ error: 'Ungueltiger Wert', detail: e.detail ?? e.message });
  throw e;
}

function isPgError(e: unknown): e is { code: string; detail?: string; message: string } {
  return typeof e === 'object' && e !== null && typeof (e as any).code === 'string' && (e as any).code.length === 5;
}
