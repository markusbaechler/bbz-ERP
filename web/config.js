// Laufzeit-Konfiguration der PWA (wird beim Deployment ersetzt, kein Build-Step).
//  authMode 'dev'   : Anmeldemaske mit Kuerzel + Rolle, Header x-user / x-user-role (Server AUTH_MODE=dev).
//  authMode 'entra' : MSAL (lib/msal-browser.min.js), Bearer-Token fuer apiScope (Server AUTH_MODE=entra).
//  apiBasis         : leer = gleiche Origin wie die PWA (Fastify liefert /app/ aus).
export default {
  authMode: 'dev',
  tenantId: '',
  clientId: '',
  apiScope: '',          // z. B. 'api://<client-id-der-api>/access_as_user'
  apiBasis: '',
};
