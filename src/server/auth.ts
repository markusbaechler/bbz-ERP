import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest { rolle: 'admin' | 'standard'; }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.rolle !== 'admin') { await reply.code(403).send({ error: 'Nur Admin' }); }
}
