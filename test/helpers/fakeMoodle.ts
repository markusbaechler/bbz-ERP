/*
 * In-Memory-Nachbildung der Moodle-REST-Schnittstelle (webservice/rest/server.php) fuer Tests.
 * Bildet nur die Funktionen ab, die das ERP nutzt; Fehler im Moodle-Format {exception, errorcode, message}.
 */
type User = { id: number; username: string; email: string; firstname: string; lastname: string; suspended?: boolean };

/** users[0][email]=x -> { users: [ { email: 'x' } ] } */
export function parsePhpParams(p: URLSearchParams): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of p) {
    const teile = [key.split('[')[0], ...[...key.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1])];
    let cur: any = out;
    teile.forEach((t, i) => {
      const letzter = i === teile.length - 1;
      const naechstIstIndex = !letzter && /^\d+$/.test(teile[i + 1]);
      if (letzter) cur[t] = value;
      else cur = cur[t] ??= naechstIstIndex ? [] : {};
    });
  }
  return out;
}

export class FakeMoodle {
  token = 'test-token';
  users: User[] = [];
  enrolments: { userid: number; courseid: number; roleid: number; timestart?: number; timeend?: number }[] = [];
  completed = new Map<string, number>();   // `${courseid}:${userid}` -> timecompleted
  ohneKriterien = new Set<number>();
  aufrufe: { wsfunction: string; params: Record<string, any> }[] = [];
  ausfall = false;
  private static naechsteId = 100;   // ueber Instanzen hinweg eindeutig (DB ueberlebt einzelne Tests)

  fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (this.ausfall) throw new Error('ECONNREFUSED');
    const p = new URLSearchParams(String(init?.body ?? ''));
    const params = parsePhpParams(p);
    const wsfunction = params.wsfunction;
    this.aufrufe.push({ wsfunction, params });
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    const fehler = (errorcode: string, message: string) => json({ exception: 'moodle_exception', errorcode, message });
    if (params.wstoken !== this.token) return fehler('invalidtoken', 'Ungültiges Token');
    switch (wsfunction) {
      case 'core_webservice_get_site_info':
        return json({ sitename: 'mybbz (Test)', release: '4.5', version: '2024100715.01', userid: 2, functions: [{ name: 'core_user_create_users', version: '1' }] });
      case 'core_user_get_users_by_field':
        return json(this.users.filter((u) => params.field === 'email' && params.values.includes(u.email)));
      case 'core_user_create_users': {
        const u = params.users[0];
        if (this.users.some((x) => x.username === u.username)) return fehler('invalidparameter', 'Username already exists');
        const user = { id: FakeMoodle.naechsteId++, username: u.username, email: u.email, firstname: u.firstname, lastname: u.lastname };
        this.users.push(user);
        return json([{ id: user.id, username: user.username }]);
      }
      case 'enrol_manual_enrol_users':
        for (const e of params.enrolments) {
          this.enrolments = this.enrolments.filter((x) => !(x.userid === Number(e.userid) && x.courseid === Number(e.courseid)));
          this.enrolments.push({ userid: Number(e.userid), courseid: Number(e.courseid), roleid: Number(e.roleid), timestart: e.timestart ? Number(e.timestart) : undefined, timeend: e.timeend ? Number(e.timeend) : undefined });
        }
        return json(null);
      case 'enrol_manual_unenrol_users':
        for (const e of params.enrolments) this.enrolments = this.enrolments.filter((x) => !(x.userid === Number(e.userid) && x.courseid === Number(e.courseid)));
        return json(null);
      case 'core_completion_get_course_completion_status': {
        if (this.ohneKriterien.has(Number(params.courseid))) return fehler('nocriteriaset', 'No completion criteria set');
        const t = this.completed.get(`${params.courseid}:${params.userid}`);
        return json({ completionstatus: { completed: t !== undefined, aggregation: 1, completions: t ? [{ timecompleted: t }] : [] }, warnings: [] });
      }
      case 'core_enrol_get_enrolled_users':
        return json(this.users.filter((u) => this.enrolments.some((e) => e.userid === u.id && e.courseid === Number(params.courseid))));
      default:
        return fehler('accessexception', `Funktion ${wsfunction} nicht freigegeben`);
    }
  }) as typeof fetch;
}
