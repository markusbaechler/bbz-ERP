export class ValidationError extends Error {}
export class NotFoundError extends Error {}
/** Fachlicher Konflikt (z. B. Doppelbuchung, Kapazitaet, Duplikat) -> HTTP 409 */
export class ConflictError extends Error {}
