/*
 * Moodle-Web-Service-Client (REST, Format JSON) fuer mybbz (Moodle 4.5, Betrieb cometas).
 * Moodle erwartet Parameter form-encoded mit PHP-Array-Syntax (users[0][email]=...) und meldet Fehler
 * mit HTTP 200 und einem Objekt {exception, errorcode, message}.
 */

export type MoodleKonfig = {
  url: string;                    // z. B. https://cometas.bankenberatungszentrum.ch
  token: string;                  // Token des Service-Users (Web-Service "bbz-erp")
  studentRolleId?: number;        // Moodle-Standard: 5 = student
  timeoutMs?: number;
  fetch?: typeof fetch;           // injizierbar fuer Tests
};

export class MoodleFehler extends Error {
  constructor(message: string, readonly errorcode: string | null = null, readonly exception: string | null = null, readonly temporaer = false) {
    super(message);
  }
}

export type MoodleBenutzer = { id: number; username: string; email: string; firstname: string; lastname: string; suspended?: boolean };
export type MoodleSiteInfo = { sitename: string; release: string; version: string; userid: number; functions: { name: string; version: string }[] };

/** Flacht ein Objekt in Moodle-Form-Parameter ab: {users:[{email:'a'}]} -> users[0][email]=a */
export function flachParameter(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj === undefined || obj === null) return out;
  if (Array.isArray(obj)) { obj.forEach((v, i) => flachParameter(v, `${prefix}[${i}]`, out)); return out; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flachParameter(v, prefix ? `${prefix}[${k}]` : k, out);
    return out;
  }
  out[prefix] = typeof obj === 'boolean' ? (obj ? '1' : '0') : String(obj);
  return out;
}

/** Moodle-Benutzernamen sind klein geschrieben; die E-Mail ist bei mybbz der naheliegende, eindeutige Name. */
export function benutzernameAusEmail(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
}

export class MoodleClient {
  private readonly f: typeof fetch;
  constructor(private readonly k: MoodleKonfig) {
    if (!k.url || !k.token) throw new Error('Moodle: url und token erforderlich');
    this.f = k.fetch ?? fetch;
  }

  get studentRolleId(): number { return this.k.studentRolleId ?? 5; }

  async aufruf<T>(wsfunction: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = new URLSearchParams({ wstoken: this.k.token, wsfunction, moodlewsrestformat: 'json', ...flachParameter(params) });
    let res: Response;
    try {
      res = await this.f(`${this.k.url.replace(/\/$/, '')}/webservice/rest/server.php`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
        signal: AbortSignal.timeout(this.k.timeoutMs ?? 20000),
      });
    } catch (e) {
      throw new MoodleFehler(`Moodle nicht erreichbar: ${(e as Error).message}`, null, null, true);
    }
    if (!res.ok) throw new MoodleFehler(`Moodle HTTP ${res.status}`, null, null, res.status >= 500 || res.status === 429);
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;   // manche Funktionen liefern "null" bei Erfolg
    if (json && typeof json === 'object' && !Array.isArray(json) && 'exception' in json) {
      throw new MoodleFehler(`${wsfunction}: ${json.message ?? json.errorcode}`, json.errorcode ?? null, json.exception ?? null);
    }
    return json as T;
  }

  siteInfo(): Promise<MoodleSiteInfo> { return this.aufruf('core_webservice_get_site_info'); }

  async findeBenutzerPerEmail(email: string): Promise<MoodleBenutzer | null> {
    const r = await this.aufruf<MoodleBenutzer[]>('core_user_get_users_by_field', { field: 'email', values: [email.trim().toLowerCase()] });
    const aktive = (r ?? []).filter((u) => !u.suspended);
    return aktive[0] ?? r?.[0] ?? null;
  }

  /** Legt einen Benutzer an; Moodle verschickt das Passwort selbst (createpassword=1). */
  async erstelleBenutzer(b: { email: string; vorname: string; nachname: string; sprache?: string }): Promise<number> {
    const r = await this.aufruf<{ id: number; username: string }[]>('core_user_create_users', {
      users: [{
        username: benutzernameAusEmail(b.email), email: b.email.trim().toLowerCase(), firstname: b.vorname || '-',
        lastname: b.nachname, auth: 'manual', createpassword: 1, lang: (b.sprache ?? 'de') === 'de' ? 'de_ch' : b.sprache,
      }],
    });
    return r[0].id;
  }

  async schreibeEin(e: { userid: number; courseid: number; timestart?: number; timeend?: number; roleid?: number }): Promise<void> {
    await this.aufruf('enrol_manual_enrol_users', { enrolments: [{ roleid: e.roleid ?? this.studentRolleId, userid: e.userid, courseid: e.courseid, timestart: e.timestart, timeend: e.timeend }] });
  }

  async schreibeAus(e: { userid: number; courseid: number }): Promise<void> {
    await this.aufruf('enrol_manual_unenrol_users', { enrolments: [{ userid: e.userid, courseid: e.courseid }] });
  }

  /** Kursabschluss; null, wenn im Kurs kein Abschluss konfiguriert ist (Moodle-Fehler "nocriteriaset"). */
  async abschluss(courseid: number, userid: number): Promise<{ abgeschlossen: boolean; zeitpunkt: number | null } | null> {
    try {
      const r = await this.aufruf<{ completionstatus: { completed: boolean; completions?: { timecompleted?: number | null }[] } }>(
        'core_completion_get_course_completion_status', { courseid, userid });
      const zeiten = (r.completionstatus.completions ?? []).map((c) => c.timecompleted ?? 0).filter((t) => t > 0);
      return { abgeschlossen: !!r.completionstatus.completed, zeitpunkt: zeiten.length ? Math.max(...zeiten) : null };
    } catch (e) {
      if (e instanceof MoodleFehler && e.errorcode === 'nocriteriaset') return null;
      throw e;
    }
  }

  eingeschriebeneBenutzer(courseid: number): Promise<MoodleBenutzer[]> {
    return this.aufruf('core_enrol_get_enrolled_users', { courseid, options: [{ name: 'userfields', value: 'id,username,email,firstname,lastname' }] });
  }
}

/** Liest MOODLE_URL/MOODLE_TOKEN; null = Moodle-Anbindung nicht konfiguriert (Outbox-Auftraege bleiben liegen). */
export function moodleAusEnv(env: NodeJS.ProcessEnv = process.env): MoodleClient | null {
  if (!env.MOODLE_URL || !env.MOODLE_TOKEN) return null;
  return new MoodleClient({ url: env.MOODLE_URL, token: env.MOODLE_TOKEN, studentRolleId: env.MOODLE_STUDENT_ROLE_ID ? Number(env.MOODLE_STUDENT_ROLE_ID) : undefined });
}
