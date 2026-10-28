// Erzeugt docs/API-ROUTEN.md aus den tatsaechlich registrierten Routen: npm run api:routen
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { buildApp } from '../src/server/app';

const routen: { method: string; url: string }[] = [];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://unbenutzt' });
const app = buildApp(pool, { integration: { moodle: null }, beiRoute: (method, url) => { if (method !== 'HEAD') routen.push({ method, url }); } });
await app.ready();
const gruppe = (u: string) => (u.startsWith('/public/') ? 'Homepage (oeffentlich, API-Schluessel)' : u.startsWith('/admin/') || u.startsWith('/integration/') ? 'Administration & Integration'
  : /^\/(organisation|kontakt|aktivitaet|verkaufschance|anfrage|crm)/.test(u) ? 'CRM'
  : /^\/(projekt|phase|meilenstein|aufgabe|zeiterfassung|einsatz|ressourcen)/.test(u) ? 'Projektmanagement'
  : /^\/(kursangebot|durchfuehrung|kurstag|anmeldung|lernnachweis|zertifizierung|bildung)/.test(u) ? 'Bildung'
  : u.startsWith('/saq') ? 'SAQ-Zertifizierung'
  : /^\/(rechnung|debitoren|auftraggeber)/.test(u) ? 'Finanzen'
  : /^\/(mitarbeitende|referent)/.test(u) ? 'Personal & Ressourcen' : 'Allgemein');
const nachGruppe = new Map<string, string[]>();
for (const r of routen.filter((r) => !r.url.includes('*')).sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method))) {
  const g = gruppe(r.url); nachGruppe.set(g, [...(nachGruppe.get(g) ?? []), `| \`${r.method}\` | \`${r.url}\` |`]);
}
const md = ['# API-Routen (generiert)', '', `Stand: ${new Date().toISOString().slice(0, 10)} · ${routen.length} Routen · erzeugt mit \`npm run api:routen\`. Fachliche Beschreibung: Spec v2 §5–§6.`, ''];
for (const [g, zeilen] of [...nachGruppe].sort()) md.push(`## ${g}`, '', '| Methode | Pfad |', '|---|---|', ...zeilen, '');
writeFileSync('docs/API-ROUTEN.md', md.join('\n'));
console.log(`${routen.length} Routen -> docs/API-ROUTEN.md`);
await app.close(); await pool.end();
