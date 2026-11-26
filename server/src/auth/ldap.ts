/**
 * LDAP/Active-Directory-Anbindung, portiert aus noten_webapp (src/auth/ldap.js).
 *
 * Zwei Modi:
 * - Service-Modus (Standard): Mit Service-Konto binden, Benutzer per Filter suchen,
 *   dann mit gefundener DN + eingegebenem Passwort erneut binden.
 * - Direkt-Modus (LDAP_BIND_USER_TEMPLATE gesetzt): Die Person bindet sofort mit eigener
 *   Kennung und Passwort, ein Service-Konto ist für den Login nicht nötig.
 *
 * Für die Verzeichnissuche der Admins ist IMMER ein Service-Konto nötig.
 * Rollen kommen nicht aus dem Verzeichnis, sondern aus ADMIN_USERS und der eigenen Datenbank.
 */
import { readFileSync } from 'node:fs';
import { Client, InvalidCredentialsError, type Entry } from 'ldapts';
import {
  NotInGroupError,
  type Authenticator,
  type DirectoryEntry,
  type DirectoryIdentity,
  type DirectorySearch,
} from './types.js';

export interface LdapConfig {
  url: string;
  baseDn: string;
  bindDn: string;
  bindPassword: string;
  /** z. B. `DOMAIN\{{username}}`; gesetzt = Direkt-Modus. */
  userBindTemplate?: string;
  userFilter: string;
  loginAttr: string;
  nameAttr: string;
  teacherSearchFilter: string;
  /** Nur Mitglieder dieser Gruppe (Name oder DN, auch verschachtelt) dürfen sich anmelden. */
  requiredGroup: string;
  tlsOptions?: { ca?: Buffer; rejectUnauthorized?: boolean };
}

export class LdapConfigError extends Error {
  override name = 'LdapConfigError';
}

/** Liest die LDAP-Konfiguration; `null`, wenn LDAP_URL fehlt (LDAP nicht eingerichtet). */
export function ldapConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LdapConfig | null {
  if (!env['LDAP_URL']) return null;
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new LdapConfigError(`Umgebungsvariable ${name} fehlt (LDAP-Konfiguration)`);
    return v;
  };
  const direct = Boolean(env['LDAP_BIND_USER_TEMPLATE']);
  const tlsOptions: NonNullable<LdapConfig['tlsOptions']> = {};
  const caPath = env['LDAP_TLS_CA_PFAD'];
  if (caPath) tlsOptions.ca = readFileSync(caPath);
  if (env['LDAP_TLS_REJECT_UNAUTHORIZED'] === 'false') tlsOptions.rejectUnauthorized = false;

  const cfg: LdapConfig = {
    url: required('LDAP_URL'),
    baseDn: required('LDAP_BASE_DN'),
    bindDn: direct ? (env['LDAP_BIND_DN'] ?? '') : required('LDAP_BIND_DN'),
    bindPassword: direct ? (env['LDAP_BIND_PW'] ?? '') : required('LDAP_BIND_PW'),
    userFilter: env['LDAP_USER_FILTER'] ?? '(sAMAccountName={{username}})',
    loginAttr: env['LDAP_LOGIN_ATTR'] ?? 'sAMAccountName',
    nameAttr: env['LDAP_NAME_ATTR'] ?? 'displayName',
    teacherSearchFilter:
      env['LDAP_TEACHER_SEARCH_FILTER'] ??
      '(&(objectClass=person)(|(cn=*{{query}}*)(sAMAccountName=*{{query}}*)(displayName=*{{query}}*)))',
    requiredGroup: (env['LDAP_REQUIRED_GROUP'] ?? '').trim(),
  };
  if (Object.keys(tlsOptions).length) cfg.tlsOptions = tlsOptions;
  if (env['LDAP_BIND_USER_TEMPLATE']) cfg.userBindTemplate = env['LDAP_BIND_USER_TEMPLATE'];
  return cfg;
}

/** RFC 4515: Sonderzeichen im Suchfilter maskieren (Injection vermeiden). */
export function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0 ]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

// AD-Suchregel LDAP_MATCHING_RULE_IN_CHAIN: findet Mitglieder auch über verschachtelte Gruppen.
const IN_CHAIN = '1.2.840.113556.1.4.1941';

type ClientFactory = (options: { url: string; tlsOptions?: LdapConfig['tlsOptions'] }) => LdapClient;

/** Der Teil des ldapts-Clients, den wir brauchen (erleichtert Tests). */
export interface LdapClient {
  bind(dn: string, password: string): Promise<unknown>;
  unbind(): Promise<unknown>;
  search(
    base: string,
    options: { scope: 'sub' | 'base'; filter: string; attributes: string[]; sizeLimit?: number },
  ): Promise<{ searchEntries: Entry[] }>;
}

const defaultFactory: ClientFactory = (options) => new Client(options) as unknown as LdapClient;

function asString(v: unknown): string | undefined {
  if (Array.isArray(v)) return v.length ? asString(v[0]) : undefined;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return v === undefined || v === null ? undefined : String(v);
}

function clientOptions(cfg: LdapConfig): { url: string; tlsOptions?: LdapConfig['tlsOptions'] } {
  return { url: cfg.url, ...(cfg.tlsOptions ? { tlsOptions: cfg.tlsOptions } : {}) };
}

async function resolveGroupDn(client: LdapClient, cfg: LdapConfig): Promise<string> {
  const raw = cfg.requiredGroup;
  if (/^[A-Za-z]+\s*=/.test(raw)) return raw; // sieht wie eine DN aus
  const name = escapeFilter(raw);
  const { searchEntries } = await client.search(cfg.baseDn, {
    scope: 'sub',
    filter: `(&(objectClass=group)(|(cn=${name})(sAMAccountName=${name})))`,
    attributes: ['dn'],
  });
  if (searchEntries.length !== 1) {
    throw new LdapConfigError(
      `Die geforderte AD-Gruppe „${raw}“ ist im Verzeichnis ${searchEntries.length === 0 ? 'nicht zu finden' : 'nicht eindeutig'} (ggf. die vollständige DN in LDAP_REQUIRED_GROUP eintragen).`,
    );
  }
  return String(searchEntries[0]!.dn);
}

async function isGroupMember(client: LdapClient, cfg: LdapConfig, userDn: string): Promise<boolean> {
  const groupDn = await resolveGroupDn(client, cfg);
  const { searchEntries } = await client.search(userDn, {
    scope: 'base',
    filter: `(memberOf:${IN_CHAIN}:=${escapeFilter(groupDn)})`,
    attributes: ['dn'],
  });
  return searchEntries.length > 0;
}

export class LdapAuthenticator implements Authenticator {
  constructor(
    private readonly cfg: LdapConfig,
    private readonly newClient: ClientFactory = defaultFactory,
  ) {}

  async authenticate(username: string, password: string): Promise<DirectoryIdentity | null> {
    if (!username || !password) return null;
    return this.cfg.userBindTemplate
      ? this.authenticateDirect(username, password)
      : this.authenticateWithService(username, password);
  }

  private identity(loginSub: string, name: string | undefined): DirectoryIdentity {
    return name !== undefined ? { loginSub, name } : { loginSub };
  }

  private async authenticateWithService(username: string, password: string): Promise<DirectoryIdentity | null> {
    const cfg = this.cfg;
    const searchClient = this.newClient(clientOptions(cfg));
    let userDn: string;
    let loginSub: string;
    let name: string | undefined;
    let member = true;
    try {
      try {
        await searchClient.bind(cfg.bindDn, cfg.bindPassword);
      } catch (err) {
        throw new LdapConfigError(
          `Service-Konto-Bind fehlgeschlagen, bitte LDAP_BIND_DN und LDAP_BIND_PW prüfen: ${(err as Error).message}`,
          { cause: err },
        );
      }
      const filter = cfg.userFilter.replace('{{username}}', escapeFilter(username));
      const { searchEntries } = await searchClient.search(cfg.baseDn, {
        scope: 'sub',
        filter,
        attributes: ['dn', cfg.loginAttr, cfg.nameAttr],
      });
      if (searchEntries.length !== 1) return null; // nicht gefunden oder mehrdeutig
      const entry = searchEntries[0]!;
      userDn = String(entry.dn);
      loginSub = asString(entry[cfg.loginAttr]) ?? username;
      name = asString(entry[cfg.nameAttr]);
      // Gruppenprüfung mit dem Service-Konto; ausgewertet wird sie erst, wenn das Passwort stimmt.
      if (cfg.requiredGroup) member = await isGroupMember(searchClient, cfg, userDn);
    } finally {
      await searchClient.unbind().catch(() => undefined);
    }

    const verifyClient = this.newClient(clientOptions(cfg));
    try {
      await verifyClient.bind(userDn, password);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) return null;
      throw err;
    } finally {
      await verifyClient.unbind().catch(() => undefined);
    }

    if (!member) throw new NotInGroupError(cfg.requiredGroup);
    return this.identity(loginSub, name);
  }

  private async authenticateDirect(username: string, password: string): Promise<DirectoryIdentity | null> {
    const cfg = this.cfg;
    const bindName = cfg.userBindTemplate!.replace('{{username}}', username);
    const client = this.newClient(clientOptions(cfg));
    try {
      try {
        await client.bind(bindName, password);
      } catch (err) {
        if (err instanceof InvalidCredentialsError) return null;
        throw err; // technischer Fehler (TLS, Netzwerk, ...)
      }

      let loginSub = username;
      let name: string | undefined;
      let userDn: string | undefined;
      try {
        const filter = cfg.userFilter.replace('{{username}}', escapeFilter(username));
        const { searchEntries } = await client.search(cfg.baseDn, {
          scope: 'sub',
          filter,
          attributes: ['dn', cfg.loginAttr, cfg.nameAttr],
        });
        if (searchEntries.length === 1) {
          const entry = searchEntries[0]!;
          userDn = String(entry.dn);
          loginSub = asString(entry[cfg.loginAttr]) ?? username;
          name = asString(entry[cfg.nameAttr]);
        }
      } catch (err) {
        // Ohne Gruppenprüfung ist die Attributsuche optional; mit Gruppenprüfung im Zweifel nicht anmelden.
        if (cfg.requiredGroup) throw err;
      }
      if (cfg.requiredGroup) {
        if (!userDn) {
          throw new LdapConfigError(
            'Gruppenprüfung nicht möglich: das Konto wurde im Verzeichnis nicht eindeutig gefunden (LDAP_USER_FILTER und LDAP_BASE_DN prüfen).',
          );
        }
        if (!(await isGroupMember(client, cfg, userDn))) throw new NotInGroupError(cfg.requiredGroup);
      }
      return this.identity(loginSub, name);
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}

/** Durchsucht das Verzeichnis nach Lehrkräften (Admin-Freischaltung); nur Mitglieder der Pflichtgruppe. */
export class LdapDirectorySearch implements DirectorySearch {
  constructor(
    private readonly cfg: LdapConfig,
    private readonly newClient: ClientFactory = defaultFactory,
  ) {}

  async search(query: string, limit = 50): Promise<DirectoryEntry[]> {
    const cfg = this.cfg;
    if (!cfg.bindDn || !cfg.bindPassword) {
      throw new LdapConfigError(
        'Für die Verzeichnissuche wird ein Service-Konto benötigt (LDAP_BIND_DN/LDAP_BIND_PW), auch im Direkt-Modus.',
      );
    }
    const client = this.newClient(clientOptions(cfg));
    try {
      await client.bind(cfg.bindDn, cfg.bindPassword);
      let filter = cfg.teacherSearchFilter.replace(/\{\{query\}\}/g, escapeFilter(query));
      if (cfg.requiredGroup) {
        filter = `(&${filter}(memberOf:${IN_CHAIN}:=${escapeFilter(await resolveGroupDn(client, cfg))}))`;
      }
      const { searchEntries } = await client.search(cfg.baseDn, {
        scope: 'sub',
        filter,
        attributes: ['dn', cfg.loginAttr, cfg.nameAttr],
        sizeLimit: limit,
      });
      return searchEntries
        .map((e) => ({
          dn: String(e.dn),
          loginSub: asString(e[cfg.loginAttr]) ?? '',
          name: asString(e[cfg.nameAttr]),
        }))
        .filter((e) => e.loginSub);
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
